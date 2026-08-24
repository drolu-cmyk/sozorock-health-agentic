const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryInstitutionalMemory } = require('../packages/runtime/institutional-memory');

const proposer = { principalId: 'planner-1' };
const reviewer = { principalId: 'reviewer-1' };

function proposal(overrides = {}) {
  return {
    geographyId: 'county:36001',
    decisionType: 'planning_interpretation',
    subjectType: 'barrier',
    subjectId: 'measure:transportation',
    outcome: 'accepted',
    reasonCodes: ['reviewed_evidence_supports_interpretation'],
    rationale: 'Reviewed evidence supports carrying this interpretation into future planning work.',
    evidenceEntityIds: ['observation:transportation', 'claim:priority-access'],
    relatedEntityIds: ['document:chip-current'],
    missingRequirements: [],
    applicability: 'reusable',
    ...overrides,
  };
}

test('proposal is not returned as institutional truth until human review approves it', () => {
  const memory = new InMemoryInstitutionalMemory({ tenantId: 'tenant-a' });
  const proposed = memory.propose(proposal(), proposer);
  assert.equal(proposed.status, 'proposed');
  assert.deepEqual(memory.query(), []);
  const reviewed = memory.review(proposed.id, 'approve', reviewer, { rationale: 'Evidence and scope reviewed.' });
  assert.equal(reviewed.status, 'reviewed');
  assert.equal(reviewed.sourceProposalId, proposed.id);
  assert.deepEqual(memory.query().map((item) => item.id), [reviewed.id]);
});

test('a proposal can be reviewed only once', () => {
  const memory = new InMemoryInstitutionalMemory({ tenantId: 'tenant-a' });
  const proposed = memory.propose(proposal(), proposer);
  memory.review(proposed.id, 'approve', reviewer, { rationale: 'Approved.' });
  assert.throws(() => memory.review(proposed.id, 'reject', reviewer, { rationale: 'Second review.' }), (error) => error.code === 'REVIEW_CONFLICT');
});

test('supersession is append-only and removes old reviewed memory from default query', () => {
  let tick = 0;
  const memory = new InMemoryInstitutionalMemory({ tenantId: 'tenant-a', clock: () => `2026-08-23T23:10:0${++tick}.000Z` });
  const proposed = memory.propose(proposal(), proposer);
  const reviewed = memory.review(proposed.id, 'approve', reviewer, { rationale: 'Approved.' });
  const superseding = memory.supersede(reviewed.id, reviewer, { reasonCodes: ['newer_evidence_release'], rationale: 'A newer reviewed evidence release changes the institutional interpretation.' });
  assert.equal(superseding.status, 'superseded');
  assert.equal(superseding.supersedesMemoryId, reviewed.id);
  assert.deepEqual(memory.query(), []);
  assert.ok(memory.query({ includeExpired: true }).some((item) => item.id === reviewed.id));
  assert.ok(memory.query({ includeExpired: true }).some((item) => item.id === superseding.id));
  assert.throws(() => memory.supersede(reviewed.id, reviewer, { reasonCodes: ['again'], rationale: 'again' }), (error) => error.code === 'SUPERSESSION_CONFLICT');
});

test('expired reviewed memory is excluded by default and reusable knowledge requires evidence', () => {
  const memory = new InMemoryInstitutionalMemory({ tenantId: 'tenant-a', clock: () => '2026-08-23T23:20:00.000Z' });
  assert.throws(() => memory.propose(proposal({ evidenceEntityIds: [] }), proposer), /between 1 and/);
  const proposed = memory.propose(proposal({ expiresAt: '2026-08-22T00:00:00Z' }), proposer);
  memory.review(proposed.id, 'approve', reviewer, { rationale: 'Approved but already expired for test.' });
  assert.deepEqual(memory.query(), []);
  assert.equal(memory.query({ includeExpired: true }).filter((item) => item.status === 'reviewed').length, 1);
});

test('ordinary workspace-like content cannot masquerade as an institutional decision type', () => {
  const memory = new InMemoryInstitutionalMemory({ tenantId: 'tenant-a' });
  assert.throws(() => memory.propose(proposal({ decisionType: 'comment' }), proposer), /unsupported/);
});
