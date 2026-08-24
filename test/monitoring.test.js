const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMonitoring } = require('../packages/cbcap/monitoring');
const { InMemoryMonitoringFindingStore } = require('../packages/runtime/monitoring-findings');

const OLD = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;

function definition(kind = 'evidence_release', overrides = {}) {
  return {
    id: `monitor-${kind}`,
    kind,
    subjectId: `${kind}:subject-1`,
    geographyId: 'county:36001',
    reviewStatus: 'verified',
    reviewedBy: 'reviewer-1',
    reviewedAt: '2026-08-20T00:00:00.000Z',
    baseline: {
      fingerprint: OLD,
      observedAt: '2026-08-20T00:00:00.000Z',
      state: null,
      deadline: null,
      validThrough: null,
      ...(overrides.baseline || {}),
    },
    ...overrides,
  };
}

function snapshot(kind = 'evidence_release', overrides = {}) {
  return {
    kind,
    subjectId: `${kind}:subject-1`,
    geographyId: 'county:36001',
    reviewStatus: 'verified',
    sourceAuthority: 'governed',
    fingerprint: OLD,
    observedAt: '2026-08-23T00:00:00.000Z',
    state: null,
    deadline: null,
    validThrough: null,
    sourceEntityIds: ['source-version:1'],
    ...overrides,
  };
}

test('unchanged governed evidence produces no persisted finding', () => {
  const result = evaluateMonitoring(definition(), snapshot(), { asOf: '2026-08-23' });
  assert.equal(result.status, 'no_change');
  assert.equal(result.shouldRecordFinding, false);
  assert.equal(result.notificationRecommended, false);
  assert.equal(result.humanReviewRequired, false);
  assert.equal(result.automaticActionTaken, false);
  assert.equal(result.automaticInstitutionalMemoryPromotion, false);
});

test('changed evidence fingerprint produces a reviewable change finding', () => {
  const result = evaluateMonitoring(definition(), snapshot('evidence_release', { fingerprint: NEW }), { asOf: '2026-08-23' });
  assert.equal(result.status, 'change_detected');
  assert.ok(result.reasonCodes.includes('governed_source_changed'));
  assert.ok(result.changedFields.includes('fingerprint'));
  assert.equal(result.shouldRecordFinding, true);
  assert.equal(result.notificationRecommended, true);
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.automaticActionTaken, false);
});

test('unverified snapshot blocks monitoring rather than treating it as a change', () => {
  const result = evaluateMonitoring(definition(), snapshot('evidence_release', { reviewStatus: 'provisional', fingerprint: NEW }), { asOf: '2026-08-23' });
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasonCodes.includes('monitor_snapshot_not_verified'));
  assert.equal(result.notificationRecommended, false);
  assert.equal(result.humanReviewRequired, true);
});

test('funding opportunity deadline and closed state surface attention without eligibility inference', () => {
  const base = definition('funding_opportunity', {
    baseline: { fingerprint: OLD, observedAt: '2026-08-01T00:00:00.000Z', state: 'open', deadline: '2026-08-22', validThrough: null },
  });
  const passed = evaluateMonitoring(base, snapshot('funding_opportunity', { state: 'open', deadline: '2026-08-22' }), { asOf: '2026-08-23' });
  assert.equal(passed.status, 'attention_required');
  assert.ok(passed.reasonCodes.includes('funding_deadline_passed'));

  const closed = evaluateMonitoring(base, snapshot('funding_opportunity', { state: 'closed', deadline: '2026-08-22' }), { asOf: '2026-08-23' });
  assert.equal(closed.status, 'attention_required');
  assert.ok(closed.reasonCodes.includes('funding_opportunity_closed'));
  assert.equal(closed.automaticActionTaken, false);
});

test('overdue workflow commitment creates attention finding', () => {
  const base = definition('workflow_commitment', {
    baseline: { fingerprint: null, observedAt: '2026-08-01T00:00:00.000Z', state: 'open', deadline: '2026-08-20', validThrough: null },
  });
  const current = snapshot('workflow_commitment', { fingerprint: null, state: 'open', deadline: '2026-08-20' });
  const result = evaluateMonitoring(base, current, { asOf: '2026-08-23' });
  assert.equal(result.status, 'attention_required');
  assert.ok(result.reasonCodes.includes('workflow_commitment_overdue'));
});

test('expired evidence creates attention finding and missing validity blocks', () => {
  const base = definition('evidence_expiry', {
    baseline: { fingerprint: OLD, observedAt: '2026-01-01T00:00:00.000Z', state: null, deadline: null, validThrough: '2026-08-20' },
  });
  const expired = evaluateMonitoring(base, snapshot('evidence_expiry', { validThrough: '2026-08-20' }), { asOf: '2026-08-23' });
  assert.equal(expired.status, 'attention_required');
  assert.ok(expired.reasonCodes.includes('evidence_expired'));

  const missing = evaluateMonitoring(base, snapshot('evidence_expiry', { validThrough: null }), { asOf: '2026-08-23' });
  assert.equal(missing.status, 'blocked');
  assert.ok(missing.reasonCodes.includes('evidence_valid_through_required'));
});

test('same stable condition has the same finding key across evaluation dates', () => {
  const base = definition('workflow_commitment', {
    baseline: { fingerprint: null, observedAt: '2026-08-01T00:00:00.000Z', state: 'open', deadline: '2026-08-20', validThrough: null },
  });
  const current = snapshot('workflow_commitment', { fingerprint: null, state: 'open', deadline: '2026-08-20' });
  const first = evaluateMonitoring(base, current, { asOf: '2026-08-23' });
  const second = evaluateMonitoring(base, current, { asOf: '2026-08-24' });
  assert.equal(first.findingKey, second.findingKey);

  const store = new InMemoryMonitoringFindingStore({ tenantId: 'tenant-a', clock: () => '2026-08-23T12:00:00.000Z' });
  const storedFirst = store.append(first);
  const storedSecond = store.append(second);
  assert.equal(storedFirst.findingKey, storedSecond.findingKey);
  assert.equal(store.list().length, 1);
});

test('finding store rejects no-change results', () => {
  const result = evaluateMonitoring(definition(), snapshot(), { asOf: '2026-08-23' });
  const store = new InMemoryMonitoringFindingStore({ tenantId: 'tenant-a' });
  assert.throws(() => store.append(result), /actionable or blocked/i);
});
