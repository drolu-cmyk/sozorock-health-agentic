const test = require('node:test');
const assert = require('node:assert/strict');
const { createCognitoPostgresInstitutionalGateway } = require('../server/cognito-postgres-institutional-runtime');

const REGION = 'us-east-1';
const USER_POOL_ID = 'us-east-1_Example123';
const APP_CLIENT_ID = '4exampleclient123';

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

function jwt(payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    token_use: 'access',
    client_id: APP_CLIENT_ID,
    iss: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
    ...payload,
  })).toString('base64url');
  return `${header}.${body}.test-signature`;
}

test('composition binds a real Cognito resolver to the expected pool and client before the supplied tenant runtime', async () => {
  const runtimeActors = [];
  const gateway = createCognitoPostgresInstitutionalGateway({
    region: REGION,
    userPoolId: USER_POOL_ID,
    appClientId: APP_CLIENT_ID,
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

  const token = jwt();
  const request = { get(name) { return name === 'authorization' ? `Bearer ${token}` : undefined; } };
  const result = await gateway.handlePlan({ location: '36001' }, { request });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.tenantId, 'tenant-a');
  assert.deepEqual(runtimeActors, [actor()]);
});

test('composition rejects a Cognito token from a different app client before tenant runtime selection', async () => {
  let runtimeCalled = false;
  const gateway = createCognitoPostgresInstitutionalGateway({
    region: REGION,
    userPoolId: USER_POOL_ID,
    appClientId: APP_CLIENT_ID,
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
            ],
          };
        },
      };
    },
    async runtimeForActor() {
      runtimeCalled = true;
      return { planningApi: { handle: async () => ({ statusCode: 202, body: {} }) } };
    },
  });
  const token = jwt({ client_id: 'differentclient123' });
  const request = { get(name) { return name === 'authorization' ? `Bearer ${token}` : undefined; } };
  const result = await gateway.handlePlan({ location: '36001' }, { request });
  assert.equal(result.statusCode, 403);
  assert.equal(runtimeCalled, false);
});

test('composition requires PostgreSQL pool when no runtime or complete memory override is supplied', () => {
  assert.throws(
    () => createCognitoPostgresInstitutionalGateway({
      identityResolver: async () => actor(),
    }),
    /PostgreSQL institutional runtime requires a pool with connect\(\)/,
  );
});

test('composition requires Cognito region, user pool, and app client when no identity override is supplied', () => {
  const runtimeForActor = async () => ({ planningApi: { handle: async () => ({ statusCode: 202, body: {} }) } });
  assert.throws(
    () => createCognitoPostgresInstitutionalGateway({ runtimeForActor }),
    /valid AWS region/,
  );
  assert.throws(
    () => createCognitoPostgresInstitutionalGateway({ region: REGION, appClientId: APP_CLIENT_ID, runtimeForActor }),
    /valid Cognito user pool ID/,
  );
  assert.throws(
    () => createCognitoPostgresInstitutionalGateway({ region: REGION, userPoolId: USER_POOL_ID, runtimeForActor }),
    /valid Cognito app client ID/,
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
