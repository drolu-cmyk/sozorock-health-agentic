const test = require('node:test');
const assert = require('node:assert/strict');
const {
  actorFromCognitoUser,
  bearerToken,
  createCognitoWorkspaceIdentityResolver,
} = require('../server/cognito-workspace-identity');

function request(authorization) {
  return { get(name) { return name === 'authorization' ? authorization : undefined; } };
}

function user(overrides = {}) {
  return {
    Username: 'principal-1',
    UserAttributes: [
      { Name: 'custom:tenant_id', Value: 'tenant-a' },
      { Name: 'custom:workspace_role', Value: 'county_planner' },
      { Name: 'custom:workspace_access', Value: 'contributor' },
      { Name: 'name', Value: 'Planner One' },
    ],
    ...overrides,
  };
}

test('bearer extraction accepts one opaque bearer token and rejects malformed sessions', () => {
  assert.equal(bearerToken(request('Bearer token-value')), 'token-value');
  assert.throws(() => bearerToken(request('Basic abc')), /authenticated workspace session/);
  assert.throws(() => bearerToken(request('Bearer ')), /authenticated workspace session/);
  assert.throws(() => bearerToken(request('Bearer token with spaces')), /authenticated workspace session/);
});

test('Cognito user attributes map to the shared workspace actor contract', () => {
  assert.deepEqual(actorFromCognitoUser(user()), {
    tenantId: 'tenant-a',
    principalId: 'principal-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner One',
  });
});

test('evidence-agent Cognito role maps to agent actor type', () => {
  const value = actorFromCognitoUser(user({
    Username: 'agent-1',
    UserAttributes: [
      { Name: 'custom:tenant_id', Value: 'tenant-a' },
      { Name: 'custom:workspace_role', Value: 'evidence_agent' },
      { Name: 'custom:workspace_access', Value: 'contributor' },
    ],
  }));
  assert.equal(value.actorType, 'agent');
  assert.equal(value.role, 'evidence_agent');
});

test('identity resolver passes only the bearer token to the configured provider', async () => {
  const seen = [];
  const resolve = createCognitoWorkspaceIdentityResolver({
    async getUser(token) {
      seen.push(token);
      return user();
    },
  });
  const value = await resolve(request('Bearer secret-access-token'));
  assert.equal(value.tenantId, 'tenant-a');
  assert.deepEqual(seen, ['secret-access-token']);
  assert.equal(JSON.stringify(value).includes('secret-access-token'), false);
});

test('provider failure and incomplete workspace assignment return generic authentication errors', async () => {
  const unavailable = createCognitoWorkspaceIdentityResolver({
    async getUser() { throw new Error('provider internals'); },
  });
  await assert.rejects(
    () => unavailable(request('Bearer token-value')),
    /valid authenticated workspace session/,
  );

  const incomplete = createCognitoWorkspaceIdentityResolver({
    async getUser() { return { Username: 'principal-1', UserAttributes: [] }; },
  });
  await assert.rejects(
    () => incomplete(request('Bearer token-value')),
    /complete county-workspace assignment/,
  );
});
