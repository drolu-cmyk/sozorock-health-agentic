const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstitutionalCBCAPGateway } = require('../server/institutional-cbcap-gateway');

function evidenceAgent() {
  return {
    tenantId: 'tenant-a',
    principalId: 'agent-1',
    actorType: 'agent',
    role: 'evidence_agent',
    access: 'viewer',
    displayName: 'Evidence Agent',
  };
}

test('authenticated evidence agent may evaluate monitoring without gaining review authority', async () => {
  let monitoringCalls = 0;
  const gateway = createInstitutionalCBCAPGateway({
    async identityResolver() { return evidenceAgent(); },
    async runtimeForActor(actor) {
      assert.equal(actor.tenantId, 'tenant-a');
      return {
        monitoringApi: {
          async handle(input, context) {
            monitoringCalls += 1;
            assert.equal(context.workspaceActor.role, 'evidence_agent');
            assert.deepEqual(input, { monitorId: 'monitor-1' });
            return { statusCode: 200, body: { contract: 'cbcap.monitoring.v1', monitorId: 'monitor-1', status: 'no_change' } };
          },
        },
      };
    },
  });

  const monitoring = await gateway.handleMonitoring({ monitorId: 'monitor-1' }, { request: {} });
  assert.equal(monitoring.statusCode, 200);
  assert.equal(monitoringCalls, 1);

  const review = await gateway.handleReview('run-1', { decision: 'approve' }, { request: {} });
  assert.equal(review.statusCode, 403);
});

test('monitoring fails closed when tenant runtime has no monitoring capability', async () => {
  const gateway = createInstitutionalCBCAPGateway({
    async identityResolver() { return evidenceAgent(); },
    async runtimeForActor() { return {}; },
  });
  const result = await gateway.handleMonitoring({ monitorId: 'monitor-1' }, { request: {} });
  assert.equal(result.statusCode, 503);
});
