const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryInstitutionalMemory } = require('../packages/runtime/institutional-memory');
const { InMemoryWorkspaceMemory } = require('../packages/runtime/workspace-memory');
const { createCBCAPMemoryApi } = require('../server/cbcap-memory-api');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a', principalId: 'planner-1', actorType: 'human',
    role: 'county_planner', access: 'contributor', displayName: 'Planner One', ...overrides,
  };
}

function proposal() {
  return {
    geographyId: 'county:36001', decisionType: 'planning_interpretation', subjectType: 'barrier',
    subjectId: 'measure:transportation', outcome: 'accepted', reasonCodes: ['reviewed_support'],
    rationale: 'Carry this reviewed interpretation into future county planning.',
    evidenceEntityIds: ['observation:transportation'], relatedEntityIds: [], missingRequirements: [], applicability: 'reusable',
  };
}

function fixture(options = {}) {
  const workspaceMemory = new InMemoryWorkspaceMemory({ tenantId: 'tenant-a' });
  const institutionalMemory = new InMemoryInstitutionalMemory({ tenantId: 'tenant-a' });
  const validator = options.validator === undefined
    ? async (_actor, ids) => ({ ok: ids.every((id) => id.startsWith('observation:')), missingIds: ids.filter((id) => !id.startsWith('observation:')) })
    : options.validator;
  return {
    workspaceMemory, institutionalMemory,
    api: createCBCAPMemoryApi({ workspaceMemory, institutionalMemory, evidenceValidator: validator }),
  };
}

test('workspace write requires human write authority while read may be shared with viewers', async () => {
  const { api } = fixture();
  const denied = await api.createWorkspace({ workspaceId: 'w1', itemType: 'task', content: {} }, { workspaceActor: actor({ access: 'viewer' }) });
  assert.equal(denied.statusCode, 403);
  const created = await api.createWorkspace({ workspaceId: 'w1', itemType: 'task', content: { owner: 'team' } }, { workspaceActor: actor() });
  assert.equal(created.statusCode, 201);
  const listed = await api.listWorkspace('w1', {}, { workspaceActor: actor({ role: 'research_funder_viewer', access: 'viewer' }) });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.items.length, 1);
});

test('workspace update uses optimistic version and returns conflict for stale edit', async () => {
  const { api } = fixture();
  const created = await api.createWorkspace({ workspaceId: 'w1', itemType: 'draft', content: { text: 'v1' } }, { workspaceActor: actor() });
  const updated = await api.updateWorkspace('w1', created.body.id, { expectedVersion: 1, patch: { content: { text: 'v2' } } }, { workspaceActor: actor() });
  assert.equal(updated.statusCode, 200);
  const stale = await api.updateWorkspace('w1', created.body.id, { expectedVersion: 1, patch: { content: { text: 'stale' } } }, { workspaceActor: actor() });
  assert.equal(stale.statusCode, 409);
});

test('institutional proposal is blocked until every evidence ID revalidates', async () => {
  const { api } = fixture();
  const invalid = await api.proposeInstitutional({ ...proposal(), evidenceEntityIds: ['unverified:item'] }, { workspaceActor: actor() });
  assert.equal(invalid.statusCode, 422);
  assert.deepEqual(invalid.body.missingEvidenceIds, ['unverified:item']);
  const valid = await api.proposeInstitutional(proposal(), { workspaceActor: actor() });
  assert.equal(valid.statusCode, 201);
  assert.equal(valid.body.status, 'proposed');
});

test('approval revalidates evidence and only authorized reviewers can promote memory', async () => {
  let valid = true;
  const { api } = fixture({ validator: async (_actor, ids) => ({ ok: valid, missingIds: valid ? [] : ids }) });
  const proposed = await api.proposeInstitutional(proposal(), { workspaceActor: actor() });
  const partnerReview = await api.reviewInstitutional(proposed.body.id, { decision: 'approve', rationale: 'Approve.' }, { workspaceActor: actor({ role: 'community_partner' }) });
  assert.equal(partnerReview.statusCode, 403);
  valid = false;
  const stale = await api.reviewInstitutional(proposed.body.id, { decision: 'approve', rationale: 'Approve.' }, { workspaceActor: actor({ role: 'foundation_reviewer' }) });
  assert.equal(stale.statusCode, 422);
  valid = true;
  const approved = await api.reviewInstitutional(proposed.body.id, { decision: 'approve', rationale: 'Evidence revalidated and approved.' }, { workspaceActor: actor({ role: 'foundation_reviewer' }) });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.status, 'reviewed');
});

test('agents can read reviewed institutional memory but cannot propose or review it', async () => {
  const { api } = fixture();
  const proposed = await api.proposeInstitutional(proposal(), { workspaceActor: actor() });
  await api.reviewInstitutional(proposed.body.id, { decision: 'approve', rationale: 'Approved.' }, { workspaceActor: actor({ role: 'foundation_reviewer' }) });
  const agent = actor({ principalId: 'agent-1', role: 'evidence_agent', actorType: 'agent', access: 'viewer' });
  const query = await api.queryInstitutional({}, { workspaceActor: agent });
  assert.equal(query.statusCode, 200);
  assert.equal(query.body.records.length, 1);
  assert.equal((await api.proposeInstitutional(proposal(), { workspaceActor: agent })).statusCode, 403);
  assert.equal((await api.reviewInstitutional(proposed.body.id, { decision: 'approve', rationale: 'No.' }, { workspaceActor: agent })).statusCode, 403);
});

test('non-reviewer cannot inspect proposed, rejected, or expired memory', async () => {
  const { api } = fixture();
  await api.proposeInstitutional(proposal(), { workspaceActor: actor() });
  const denied = await api.queryInstitutional({ includeProposed: true }, { workspaceActor: actor({ role: 'community_partner' }) });
  assert.equal(denied.statusCode, 403);
  const reviewer = await api.queryInstitutional({ includeProposed: true }, { workspaceActor: actor({ role: 'foundation_reviewer' }) });
  assert.equal(reviewer.statusCode, 200);
  assert.equal(reviewer.body.records.length, 1);
});

test('proposal fails closed if institutional evidence validator is unavailable', async () => {
  const { api } = fixture({ validator: null });
  const result = await api.proposeInstitutional(proposal(), { workspaceActor: actor() });
  assert.equal(result.statusCode, 503);
});
