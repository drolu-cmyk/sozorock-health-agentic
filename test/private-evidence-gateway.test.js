const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstitutionalCBCAPGateway } = require('../server/institutional-cbcap-gateway');
const { permissionDecision } = require('../packages/runtime/workspace-identity');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'planner-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner',
    ...overrides,
  };
}

test('private evidence submission and review preserve human authority while reviewed metadata may be read by evidence agents', () => {
  const planner = actor();
  const agent = actor({ principalId: 'agent-1', actorType: 'agent', role: 'evidence_agent', access: 'viewer' });
  const viewer = actor({ access: 'viewer' });
  const community = actor({ role: 'community_partner' });

  assert.equal(permissionDecision(planner, 'cbcap.private_evidence.submit').ok, true);
  assert.equal(permissionDecision(planner, 'cbcap.private_evidence.review').ok, true);
  assert.equal(permissionDecision(viewer, 'cbcap.private_evidence.submit').ok, false);
  assert.equal(permissionDecision(community, 'cbcap.private_evidence.review').ok, false);
  assert.equal(permissionDecision(agent, 'cbcap.private_evidence.read').ok, true);
  assert.equal(permissionDecision(agent, 'cbcap.private_evidence.submit').ok, false);
  assert.equal(permissionDecision(agent, 'cbcap.private_evidence.review').ok, false);
});

test('gateway derives private evidence authority from authenticated workspace actor before runtime selection', async () => {
  const calls = [];
  const gateway = createInstitutionalCBCAPGateway({
    async identityResolver() { return actor(); },
    async runtimeForActor(resolvedActor) {
      calls.push(['runtime', resolvedActor.tenantId]);
      return {
        privateEvidenceApi: {
          async submit(input, context) {
            calls.push(['submit', input.uploadId, context.workspaceActor.principalId]);
            return { statusCode: 201, body: { documentId: 'doc-1' } };
          },
          async review(documentId, input, context) {
            calls.push(['review', documentId, input.decision, context.workspaceActor.principalId]);
            return { statusCode: 201, body: { documentId } };
          },
          async query(input, context) {
            calls.push(['query', input.geographyId, context.workspaceActor.principalId]);
            return { statusCode: 200, body: { documents: [] } };
          },
        },
      };
    },
  });

  assert.equal((await gateway.handlePrivateEvidenceSubmit({ uploadId: 'upload-1' }, { request: {} })).statusCode, 201);
  assert.equal((await gateway.handlePrivateEvidenceReview('doc-1', { decision: 'accepted' }, { request: {} })).statusCode, 201);
  assert.equal((await gateway.handlePrivateEvidenceQuery({ geographyId: 'county:36001' }, { request: {} })).statusCode, 200);
  assert.deepEqual(calls, [
    ['runtime', 'tenant-a'],
    ['submit', 'upload-1', 'planner-1'],
    ['runtime', 'tenant-a'],
    ['review', 'doc-1', 'accepted', 'planner-1'],
    ['runtime', 'tenant-a'],
    ['query', 'county:36001', 'planner-1'],
  ]);
});

test('unauthorized private evidence review fails before tenant runtime selection', async () => {
  let runtimeCalled = false;
  const gateway = createInstitutionalCBCAPGateway({
    async identityResolver() { return actor({ role: 'community_partner' }); },
    async runtimeForActor() { runtimeCalled = true; return {}; },
  });
  const result = await gateway.handlePrivateEvidenceReview('doc-1', { decision: 'accepted' }, { request: {} });
  assert.equal(result.statusCode, 403);
  assert.equal(runtimeCalled, false);
});
