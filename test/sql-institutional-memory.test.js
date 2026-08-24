const test = require('node:test');
const assert = require('node:assert/strict');
const { SqlInstitutionalMemory } = require('../packages/runtime/sql-institutional-memory');

const actor = { principalId: 'reviewer-1' };

function row(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111', tenant_id: 'tenant-a', geography_id: 'county:36001',
    decision_type: 'planning_interpretation', subject_type: 'barrier', subject_id: 'measure:transportation',
    outcome: 'accepted', reason_codes: ['support'], rationale: 'Reviewed interpretation.', evidence_entity_ids: ['obs:1'],
    related_entity_ids: [], missing_requirements: [], status: 'proposed', applicability: 'reusable',
    proposed_by: 'planner-1', proposed_at: '2026-08-23T23:40:00Z', reviewed_by: null, reviewed_at: null,
    review_decision: null, review_rationale: null, source_proposal_id: null, supersedes_memory_id: null, expires_at: null,
    ...overrides,
  };
}

test('SQL proposal insert is tenant scoped and append-only by construction', async () => {
  let seen;
  const memory = new SqlInstitutionalMemory({
    tenantId: 'tenant-a', clock: () => '2026-08-23T23:40:00Z',
    query: async (sql, params) => { seen = { sql, params }; return { rows: [row({ id: params[0] })] }; },
  });
  const record = await memory.propose({
    geographyId: 'county:36001', decisionType: 'planning_interpretation', subjectType: 'barrier', subjectId: 'measure:transportation',
    outcome: 'accepted', reasonCodes: ['support'], rationale: 'Reviewed interpretation.', evidenceEntityIds: ['obs:1'], applicability: 'reusable',
  }, { principalId: 'planner-1' });
  assert.equal(record.status, 'proposed');
  assert.equal(seen.params[1], 'tenant-a');
  assert.match(seen.sql, /INSERT INTO cbcap_institutional_memory/);
});

test('SQL review creates a new record sourced from immutable proposal', async () => {
  let seen;
  const memory = new SqlInstitutionalMemory({ tenantId: 'tenant-a', clock: () => '2026-08-23T23:41:00Z', query: async (sql, params) => {
    seen = { sql, params };
    return { rows: [row({ id: params[0], status: 'reviewed', reviewed_by: params[4], reviewed_at: params[5], review_decision: params[3], source_proposal_id: params[2] })] };
  } });
  const reviewed = await memory.review('11111111-1111-4111-8111-111111111111', 'approve', actor, { rationale: 'Approved after evidence review.' });
  assert.equal(reviewed.status, 'reviewed');
  assert.equal(reviewed.sourceProposalId, '11111111-1111-4111-8111-111111111111');
  assert.match(seen.sql, /SELECT .* FROM cbcap_institutional_memory/s);
  assert.match(seen.sql, /status='proposed'/);
});

test('SQL duplicate transition errors are translated into governance conflicts', async () => {
  const duplicate = new Error('duplicate'); duplicate.code = '23505';
  const memory = new SqlInstitutionalMemory({ tenantId: 'tenant-a', query: async () => { throw duplicate; } });
  await assert.rejects(() => memory.review('11111111-1111-4111-8111-111111111111','approve',actor,{ rationale:'approved' }), (error) => error.code === 'REVIEW_CONFLICT');
  await assert.rejects(() => memory.supersede('11111111-1111-4111-8111-111111111111',actor,{ reasonCodes:['newer'], rationale:'newer evidence' }), (error) => error.code === 'SUPERSESSION_CONFLICT');
});

test('SQL default institutional query includes reviewed active records but excludes superseded records through NOT EXISTS', async () => {
  let seen;
  const memory = new SqlInstitutionalMemory({ tenantId: 'tenant-a', query: async (sql, params) => { seen = { sql, params }; return { rows: [] }; } });
  await memory.queryMemory({ geographyId: 'county:36001' });
  assert.match(seen.sql, /memory.status='reviewed'/);
  assert.match(seen.sql, /NOT EXISTS/);
  assert.match(seen.sql, /supersedes_memory_id=memory.id/);
  assert.equal(seen.params[0], 'tenant-a');
});
