const crypto = require('crypto');

const DECISION_TYPES = Object.freeze([
  'planning_interpretation',
  'funding_fit',
  'partner_requirement',
  'scenario_decision',
  'evidence_correction',
  'publication_decision',
  'monitoring_commitment',
]);

const DECISION_OUTCOMES = Object.freeze([
  'accepted',
  'rejected',
  'needs_revision',
  'deferred',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requiredString(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function optionalString(value, label, max = 500) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, label, max);
}

function strings(value, label, { min = 0, max = 500 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain between ${min} and ${max} items.`);
  }
  return [...new Set(value.map((item, index) => requiredString(item, `${label}[${index}]`, 500)))];
}

function timestamp(value, label, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  const normalized = requiredString(value, label, 80);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return normalized;
}

function validateProposal(input, context = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('institutional memory proposal must be an object.');
  const decisionType = requiredString(input.decisionType, 'decisionType', 80);
  if (!DECISION_TYPES.includes(decisionType)) throw new Error('decisionType is unsupported.');
  const outcome = requiredString(input.outcome, 'outcome', 80);
  if (!DECISION_OUTCOMES.includes(outcome)) throw new Error('outcome is unsupported.');
  const applicability = input.applicability || 'context_specific';
  if (!['context_specific', 'reusable'].includes(applicability)) throw new Error('applicability is unsupported.');
  return {
    tenantId: requiredString(context.tenantId, 'tenantId', 200),
    geographyId: requiredString(input.geographyId, 'geographyId', 240),
    decisionType,
    subjectType: requiredString(input.subjectType, 'subjectType', 120),
    subjectId: requiredString(input.subjectId, 'subjectId', 240),
    outcome,
    reasonCodes: strings(input.reasonCodes, 'reasonCodes', { min: 1, max: 50 }),
    rationale: requiredString(input.rationale, 'rationale', 5000),
    evidenceEntityIds: strings(input.evidenceEntityIds, 'evidenceEntityIds', { min: 1, max: 500 }),
    relatedEntityIds: strings(input.relatedEntityIds || [], 'relatedEntityIds'),
    missingRequirements: strings(input.missingRequirements || [], 'missingRequirements'),
    applicability,
    expiresAt: timestamp(input.expiresAt, 'expiresAt'),
  };
}

function activeAt(record, asOf) {
  if (!record.expiresAt) return true;
  return Date.parse(record.expiresAt) > Date.parse(asOf);
}

class InMemoryInstitutionalMemory {
  constructor(options = {}) {
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
    this.clock = options.clock || (() => new Date().toISOString());
    this.records = [];
  }

  propose(input, actor) {
    const proposal = validateProposal(input, { tenantId: this.tenantId });
    const now = this.clock();
    const record = {
      id: crypto.randomUUID(),
      ...proposal,
      status: 'proposed',
      proposedBy: requiredString(actor.principalId, 'actor.principalId', 200),
      proposedAt: now,
      reviewedBy: null,
      reviewedAt: null,
      reviewDecision: null,
      reviewRationale: null,
      sourceProposalId: null,
      supersedesMemoryId: null,
    };
    this.records.push(clone(record));
    return clone(record);
  }

  get(recordId) {
    const id = requiredString(recordId, 'recordId', 128);
    return clone(this.records.find((record) => record.id === id && record.tenantId === this.tenantId) || null);
  }

  review(proposalId, decision, actor, options = {}) {
    const proposal = this.records.find((record) => record.id === proposalId && record.status === 'proposed');
    if (!proposal) return null;
    if (this.records.some((record) => record.sourceProposalId === proposal.id)) {
      const error = new Error('Institutional memory proposal has already been reviewed.');
      error.code = 'REVIEW_CONFLICT';
      throw error;
    }
    if (!['approve', 'reject'].includes(decision)) throw new Error('review decision must be approve or reject.');
    const now = this.clock();
    const record = {
      ...clone(proposal),
      id: crypto.randomUUID(),
      status: decision === 'approve' ? 'reviewed' : 'rejected',
      reviewedBy: requiredString(actor.principalId, 'actor.principalId', 200),
      reviewedAt: now,
      reviewDecision: decision,
      reviewRationale: requiredString(options.rationale, 'review rationale', 5000),
      sourceProposalId: proposal.id,
    };
    this.records.push(clone(record));
    return clone(record);
  }

  supersede(memoryId, actor, input = {}) {
    const current = this.records.find((record) => record.id === memoryId && record.status === 'reviewed');
    if (!current) return null;
    if (this.records.some((record) => record.supersedesMemoryId === current.id)) {
      const error = new Error('Institutional memory has already been superseded.');
      error.code = 'SUPERSESSION_CONFLICT';
      throw error;
    }
    const now = this.clock();
    const record = {
      ...clone(current),
      id: crypto.randomUUID(),
      status: 'superseded',
      outcome: 'superseded',
      reasonCodes: strings(input.reasonCodes, 'reasonCodes', { min: 1, max: 50 }),
      rationale: requiredString(input.rationale, 'rationale', 5000),
      reviewedBy: requiredString(actor.principalId, 'actor.principalId', 200),
      reviewedAt: now,
      reviewDecision: 'supersede',
      reviewRationale: requiredString(input.rationale, 'rationale', 5000),
      sourceProposalId: null,
      supersedesMemoryId: current.id,
      applicability: 'expired',
      expiresAt: now,
    };
    this.records.push(clone(record));
    return clone(record);
  }

  query(input = {}) {
    const asOf = timestamp(input.asOf || this.clock(), 'asOf', true);
    const includeProposed = input.includeProposed === true;
    const includeRejected = input.includeRejected === true;
    const includeExpired = input.includeExpired === true;
    const geographyId = optionalString(input.geographyId, 'geographyId', 240);
    const decisionType = optionalString(input.decisionType, 'decisionType', 80);
    const subjectId = optionalString(input.subjectId, 'subjectId', 240);
    const supersededIds = new Set(this.records.filter((record) => record.status === 'superseded' && record.supersedesMemoryId).map((record) => record.supersedesMemoryId));

    return this.records
      .filter((record) => {
        if (record.tenantId !== this.tenantId) return false;
        if (geographyId && record.geographyId !== geographyId) return false;
        if (decisionType && record.decisionType !== decisionType) return false;
        if (subjectId && record.subjectId !== subjectId) return false;
        if (record.status === 'proposed' && !includeProposed) return false;
        if (record.status === 'rejected' && !includeRejected) return false;
        if (record.status === 'superseded') return includeExpired;
        if (record.status === 'reviewed' && supersededIds.has(record.id) && !includeExpired) return false;
        if (!includeExpired && !activeAt(record, asOf)) return false;
        return record.status === 'reviewed' || includeProposed || includeRejected || includeExpired;
      })
      .sort((a, b) => (b.reviewedAt || b.proposedAt).localeCompare(a.reviewedAt || a.proposedAt))
      .map(clone);
  }
}

module.exports = {
  DECISION_OUTCOMES,
  DECISION_TYPES,
  InMemoryInstitutionalMemory,
  validateProposal,
};
