const crypto = require('crypto');

const MONITORING_CONTRACT = 'cbcap.monitoring.v1';
const MONITOR_KINDS = Object.freeze([
  'evidence_release',
  'planning_document',
  'funding_opportunity',
  'workflow_commitment',
  'evidence_expiry',
]);
const FINDING_STATUSES = Object.freeze([
  'no_change',
  'change_detected',
  'attention_required',
  'blocked',
]);

function requiredString(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function optionalString(value, label, max = 1000) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, label, max);
}

function dateOnly(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = requiredString(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${label} must be YYYY-MM-DD.`);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${label} must be a valid calendar date.`);
  }
  return normalized;
}

function isoTimestamp(value, label) {
  const normalized = requiredString(value, label, 80);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return normalized;
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function fingerprint(value, label) {
  const normalized = requiredString(value, label, 120);
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be a sha256 hash.`);
  return normalized;
}

function stringList(value, label, max = 200) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be an array with at most ${max} items.`);
  const normalized = value.map((item, index) => requiredString(item, `${label}[${index}]`, 500));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return normalized;
}

function normalizeState(value) {
  return optionalString(value, 'state', 80)?.toLowerCase() || null;
}

function normalizeDefinition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('monitor definition must be an object.');
  const kind = requiredString(input.kind, 'monitor kind', 80);
  if (!MONITOR_KINDS.includes(kind)) throw new Error('monitor kind is unsupported.');
  const reviewStatus = requiredString(input.reviewStatus, 'monitor reviewStatus', 40);
  const baseline = input.baseline;
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) throw new Error('monitor baseline is required.');
  return {
    id: requiredString(input.id, 'monitor id', 240),
    kind,
    subjectId: requiredString(input.subjectId, 'monitor subjectId', 240),
    geographyId: optionalString(input.geographyId, 'monitor geographyId', 240),
    reviewStatus,
    reviewedBy: requiredString(input.reviewedBy, 'monitor reviewedBy', 240),
    reviewedAt: isoTimestamp(input.reviewedAt, 'monitor reviewedAt'),
    baseline: {
      fingerprint: baseline.fingerprint ? fingerprint(baseline.fingerprint, 'monitor baseline fingerprint') : null,
      observedAt: isoTimestamp(baseline.observedAt, 'monitor baseline observedAt'),
      state: normalizeState(baseline.state),
      deadline: dateOnly(baseline.deadline, 'monitor baseline deadline'),
      validThrough: dateOnly(baseline.validThrough, 'monitor baseline validThrough'),
    },
  };
}

function normalizeSnapshot(input, definition) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('monitor snapshot must be an object.');
  const kind = requiredString(input.kind, 'snapshot kind', 80);
  const subjectId = requiredString(input.subjectId, 'snapshot subjectId', 240);
  if (kind !== definition.kind) throw new Error('snapshot kind does not match monitor definition.');
  if (subjectId !== definition.subjectId) throw new Error('snapshot subject does not match monitor definition.');
  const reviewStatus = requiredString(input.reviewStatus, 'snapshot reviewStatus', 40);
  const sourceAuthority = requiredString(input.sourceAuthority, 'snapshot sourceAuthority', 80);
  if (sourceAuthority !== 'governed') throw new Error('snapshot sourceAuthority must be governed.');
  return {
    kind,
    subjectId,
    geographyId: optionalString(input.geographyId, 'snapshot geographyId', 240),
    reviewStatus,
    sourceAuthority,
    fingerprint: input.fingerprint ? fingerprint(input.fingerprint, 'snapshot fingerprint') : null,
    observedAt: isoTimestamp(input.observedAt, 'snapshot observedAt'),
    state: normalizeState(input.state),
    deadline: dateOnly(input.deadline, 'snapshot deadline'),
    validThrough: dateOnly(input.validThrough, 'snapshot validThrough'),
    sourceEntityIds: stringList(input.sourceEntityIds || [], 'snapshot sourceEntityIds'),
  };
}

function changedFields(definition, snapshot) {
  const fields = [];
  if (definition.baseline.fingerprint && snapshot.fingerprint && definition.baseline.fingerprint !== snapshot.fingerprint) fields.push('fingerprint');
  if (definition.baseline.state !== snapshot.state) fields.push('state');
  if (definition.baseline.deadline !== snapshot.deadline) fields.push('deadline');
  if (definition.baseline.validThrough !== snapshot.validThrough) fields.push('validThrough');
  return fields;
}

function findingKey(definition, snapshot, status, reasonCodes, asOf) {
  return sha256(JSON.stringify({
    contract: MONITORING_CONTRACT,
    monitorId: definition.id,
    subjectId: definition.subjectId,
    kind: definition.kind,
    baselineFingerprint: definition.baseline.fingerprint,
    currentFingerprint: snapshot?.fingerprint || null,
    currentState: snapshot?.state || null,
    currentDeadline: snapshot?.deadline || null,
    currentValidThrough: snapshot?.validThrough || null,
    status,
    reasonCodes: [...reasonCodes].sort(),
    asOf,
  }));
}

function evaluateMonitoring(definitionInput, snapshotInput, options = {}) {
  const definition = normalizeDefinition(definitionInput);
  const asOf = dateOnly(options.asOf || new Date().toISOString().slice(0, 10), 'monitor asOf');
  let snapshot;
  let status = 'no_change';
  const reasonCodes = [];
  const limitations = [
    'Monitoring reports governed source changes and timing conditions; it does not decide the institutional response.',
    'A change finding does not mean the new source is substantively better, worse, eligible, ineligible, or automatically adopted.',
    'No notification, workflow update, institutional-memory promotion, or production change occurs automatically from this evaluation.',
  ];

  if (definition.reviewStatus !== 'verified') reasonCodes.push('monitor_definition_not_verified');

  try {
    snapshot = normalizeSnapshot(snapshotInput, definition);
  } catch {
    reasonCodes.push('governed_snapshot_invalid');
  }

  if (snapshot) {
    if (snapshot.reviewStatus !== 'verified') reasonCodes.push('monitor_snapshot_not_verified');
    if (definition.geographyId && snapshot.geographyId !== definition.geographyId) reasonCodes.push('monitor_geography_mismatch');
    if (snapshot.observedAt.slice(0, 10) > asOf) reasonCodes.push('snapshot_observed_after_as_of');
  }

  let changes = [];
  if (reasonCodes.length) {
    status = 'blocked';
  } else {
    changes = changedFields(definition, snapshot);

    if (definition.kind === 'evidence_release' || definition.kind === 'planning_document') {
      if (!definition.baseline.fingerprint || !snapshot.fingerprint) {
        status = 'blocked';
        reasonCodes.push('monitor_fingerprint_required');
      } else if (definition.baseline.fingerprint !== snapshot.fingerprint) {
        status = 'change_detected';
        reasonCodes.push('governed_source_changed');
      }
    }

    if (definition.kind === 'funding_opportunity') {
      if (definition.baseline.fingerprint && snapshot.fingerprint && definition.baseline.fingerprint !== snapshot.fingerprint) {
        status = 'change_detected';
        reasonCodes.push('funding_criteria_or_source_changed');
      }
      if (snapshot.state && ['closed', 'cancelled', 'withdrawn'].includes(snapshot.state)) {
        status = 'attention_required';
        reasonCodes.push(`funding_opportunity_${snapshot.state}`);
      } else if (snapshot.deadline && snapshot.deadline < asOf) {
        status = 'attention_required';
        reasonCodes.push('funding_deadline_passed');
      } else if (definition.baseline.deadline !== snapshot.deadline) {
        status = status === 'no_change' ? 'change_detected' : status;
        reasonCodes.push('funding_deadline_changed');
      }
    }

    if (definition.kind === 'workflow_commitment') {
      if (snapshot.state && ['completed', 'cancelled'].includes(snapshot.state)) {
        if (definition.baseline.state !== snapshot.state) {
          status = 'change_detected';
          reasonCodes.push('workflow_commitment_state_changed');
        }
      } else if (snapshot.deadline && snapshot.deadline < asOf) {
        status = 'attention_required';
        reasonCodes.push('workflow_commitment_overdue');
      } else if (definition.baseline.state !== snapshot.state || definition.baseline.deadline !== snapshot.deadline) {
        status = 'change_detected';
        reasonCodes.push('workflow_commitment_changed');
      }
    }

    if (definition.kind === 'evidence_expiry') {
      if (!snapshot.validThrough) {
        status = 'blocked';
        reasonCodes.push('evidence_valid_through_required');
      } else if (snapshot.validThrough < asOf) {
        status = 'attention_required';
        reasonCodes.push('evidence_expired');
      } else if (definition.baseline.validThrough !== snapshot.validThrough || (definition.baseline.fingerprint && snapshot.fingerprint && definition.baseline.fingerprint !== snapshot.fingerprint)) {
        status = 'change_detected';
        reasonCodes.push('evidence_validity_changed');
      }
    }
  }

  if (!FINDING_STATUSES.includes(status)) throw new Error('monitor evaluator produced an unsupported status.');
  const sortedReasons = [...new Set(reasonCodes)].sort();
  const actionable = status === 'change_detected' || status === 'attention_required';
  const blocked = status === 'blocked';

  return {
    contract: MONITORING_CONTRACT,
    monitorId: definition.id,
    kind: definition.kind,
    subjectId: definition.subjectId,
    geographyId: definition.geographyId,
    status,
    reasonCodes: sortedReasons,
    changedFields: [...new Set(changes)].sort(),
    asOf,
    baseline: definition.baseline,
    current: snapshot || null,
    findingKey: findingKey(definition, snapshot, status, sortedReasons, asOf),
    shouldRecordFinding: actionable || blocked,
    notificationRecommended: actionable,
    humanReviewRequired: actionable || blocked,
    automaticActionTaken: false,
    automaticInstitutionalMemoryPromotion: false,
    limitations,
  };
}

module.exports = {
  FINDING_STATUSES,
  MONITORING_CONTRACT,
  MONITOR_KINDS,
  evaluateMonitoring,
  normalizeDefinition,
  normalizeSnapshot,
};