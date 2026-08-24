const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstitutionalCBCAPGateway } = require('../server/institutional-cbcap-gateway');
const { permissionDecision } = require('../packages/runtime/workspace-identity');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'agent-1',
    actorType: 'agent',
    role: 'evidence_agent',
    access: 'viewer',
    displayName: 'Evidence Agent',
    ...overrides,
  };
}

test('workforce capacity is nonconsequential evidence analysis and grants no human decision authority', () => {
  assert.equal(permissionDecision(actor(), 'cbcap.workforce.view').ok, true);
  assert.equal(permissionDecision(actor(), 'cbcap.plan.create').ok, false);
  assert.equal(permissionDecision(actor(), 'cbcap.plan.review').ok, false);
  assert.equal(permissionDecision(actor(), 'cbcap.funding.evaluate').ok, false);
});

test('institutional gateway authenticates before selecting workforce tenant runtime', async () => {
  const seen = [];
  const gateway = createInstitutionalCBCAPGateway({
    async identityResolver(request) {
      seen.push(['identity', request.marker]);
      return actor();
    },
    async runtimeForActor(resolvedActor) {
      seen.push(['runtime', resolvedActor.tenantId]);
      return {
        workforceApi: {
          async handle(input, context) {
            seen.push(['workforce', input.countyFips, context.workspaceActor.principalId]);
            return { statusCode: 200, body: { contract: 'cbcap.workforce-capacity.v1', countyFips: input.countyFips } };
          },
        },
      };
    },
  });

  const result = await gateway.handleWorkforce({ countyFips: '36001' }, { request: { marker: 'request-1' } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(seen, [
    ['identity', 'request-1'],
    ['runtime', 'tenant-a'],
    ['workforce', '36001', 'agent-1'],
  ]);
});

test('invalid workforce identity fails before tenant runtime selection', async () => {
  let runtimeCalled = false;
  const gateway = createInstitutionalCBCAPGateway({
    async identityResolver() { throw new Error('invalid token'); },
    async runtimeForActor() { runtimeCalled = true; return {}; },
  });
  const result = await gateway.handleWorkforce({ countyFips: '36001' }, { request: {} });
  assert.equal(result.statusCode, 403);
  assert.equal(runtimeCalled, false);
});

test('workforce route fails closed when selected tenant runtime does not expose workforce capability', async () => {
  const gateway = createInstitutionalCBCAPGateway({
    async identityResolver() { return actor(); },
    async runtimeForActor() { return {}; },
  });
  const result = await gateway.handleWorkforce({ countyFips: '36001' }, { request: {} });
  assert.equal(result.statusCode, 503);
});
