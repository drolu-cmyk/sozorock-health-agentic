const test = require('node:test');
const assert = require('node:assert/strict');
const { createCognitoPostgresInstitutionalGateway } = require('../server/cognito-postgres-institutional-runtime');

function actor() {
  return {
    tenantId: 'tenant-a',
    principalId: 'principal-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner One',
  };
}

test('composition uses real Cognito resolver before the supplied tenant runtime', async () => {
  const runtimeActors = [];
  const gateway = createCognitoPostgresInstitutionalGateway({
    region: 'us-east-1',
    async cognitoFetchImpl() {
      return {
        ok: true,
        async json() {
          return {
            Username: 'principal-1',
            UserAttributes: [
              { Name: 'custom:tenant_id', Value: 'tenant-a' },
              { Name: 'custom:workspace_role', Value: 'county_planner' },
              { Name: 'custom:workspace_access', Value: 'contributor' },
              { Name: 'name', Value: 'Planner One' },
            ],
          };
        },
      };
    },
    async runtimeForActor(resolvedActor) {
      runtimeActors.push(structuredClone(resolvedActor));
      return {
        planningApi: {
          async handle(input) {
            return { statusCode: 202, body: { status: 'awaiting_human_review', tenantId: resolvedActor.tenantId, input } };
          },
        },
        reviewApi: {
          async handle(runId) {
            return { statusCode: 200, body: { status: 'approved_output', runId, tenantId: resolvedActor.tenantId } };
          },
        },
      };
    },
  });

  const request = { get(name) { return name === 'authorization' ? 'Bearer opaque-token' : undefined; } };
  const result = await gateway.handlePlan({ location: '36001' }, { request });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.tenantId, 'tenant-a');
  assert.deepEqual(runtimeActors, [actor()]);
});

test('composition requires PostgreSQL pool when no runtime or memory override is supplied', () => {
  assert.throws(
    () => createCognitoPostgresInstitutionalGateway({
      identityResolver: async () => actor(),
    }),
    /PostgreSQL run-memory factory requires a pool/,
  );
});

test('composition requires a valid Cognito region when no identity override is supplied', () => {
  assert.throws(
    () => createCognitoPostgresInstitutionalGateway({
      runtimeForActor: async () => ({ planningApi: { handle: async () => ({ statusCode: 202, body: {} }) } }),
    }),
    /valid AWS region/,
  );
});

test('composition accepts explicit identity and memory overrides for deterministic testing', async () => {
  const memoryActors = [];
  const runtimeRequests = [];
  const gateway = createCognitoPostgresInstitutionalGateway({
    identityResolver: async () => actor(),
    memoryForActor(resolvedActor) {
      memoryActors.push(structuredClone(resolvedActor));
      return {
        createRun() { throw new Error('not exercised'); },
        read() { return []; },
      };
    },
    evidenceClientForActor() {
      return {
        async getCountyPackage() {
          throw new Error('not exercised in this construction-only test');
        },
      };
    },
    runtimeForActor: async (resolvedActor) => {
      runtimeRequests.push(structuredClone(resolvedActor));
      return {
        planningApi: { async handle() { return { statusCode: 202, body: { status: 'awaiting_human_review' } }; } },
        reviewApi: null,
      };
    },
  });

  const result = await gateway.handlePlan({ location: '36001' }, { request: {} });
  assert.equal(result.statusCode, 202);
  assert.deepEqual(runtimeRequests, [actor()]);
  assert.deepEqual(memoryActors, []);
});
