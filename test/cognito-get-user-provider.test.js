const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COGNITO_TARGET,
  accessToken,
  cognitoEndpoint,
  createCognitoGetUserProvider,
  createCognitoWorkspaceResolver,
} = require('../server/cognito-get-user-provider');

function okResponse(body) {
  return {
    ok: true,
    async json() { return structuredClone(body); },
  };
}

function cognitoUser() {
  return {
    Username: 'principal-1',
    UserAttributes: [
      { Name: 'custom:tenant_id', Value: 'tenant-a' },
      { Name: 'custom:workspace_role', Value: 'county_planner' },
      { Name: 'custom:workspace_access', Value: 'contributor' },
      { Name: 'name', Value: 'Planner One' },
    ],
  };
}

test('Cognito endpoint is region-scoped and uses China partition suffix when required', () => {
  assert.equal(cognitoEndpoint('us-east-1'), 'https://cognito-idp.us-east-1.amazonaws.com/');
  assert.equal(cognitoEndpoint('us-gov-west-1'), 'https://cognito-idp.us-gov-west-1.amazonaws.com/');
  assert.equal(cognitoEndpoint('cn-north-1'), 'https://cognito-idp.cn-north-1.amazonaws.com.cn/');
  assert.throws(() => cognitoEndpoint(''), /valid AWS region/);
  assert.throws(() => cognitoEndpoint('https://example.com'), /valid AWS region/);
});

test('access token validation rejects empty, oversized, and whitespace-bearing tokens', () => {
  assert.equal(accessToken('opaque-token'), 'opaque-token');
  assert.throws(() => accessToken(''), /valid Cognito access token/);
  assert.throws(() => accessToken('token with spaces'), /valid Cognito access token/);
  assert.throws(() => accessToken('x'.repeat(8193)), /valid Cognito access token/);
});

test('GetUser provider sends the exact AWS JSON protocol without returning the token', async () => {
  const calls = [];
  const getUser = createCognitoGetUserProvider({
    region: 'us-east-1',
    timeoutMs: 1000,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return okResponse(cognitoUser());
    },
  });

  const value = await getUser('secret-access-token');
  assert.equal(value.Username, 'principal-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://cognito-idp.us-east-1.amazonaws.com/');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-amz-json-1.1');
  assert.equal(calls[0].options.headers['X-Amz-Target'], COGNITO_TARGET);
  assert.deepEqual(JSON.parse(calls[0].options.body), { AccessToken: 'secret-access-token' });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(value).includes('secret-access-token'), false);
});

test('GetUser provider sanitizes network, rejection, and response parsing failures', async () => {
  const unavailable = createCognitoGetUserProvider({
    region: 'us-east-1',
    async fetchImpl() { throw new Error('socket secret detail'); },
  });
  await assert.rejects(() => unavailable('token-value'), /identity provider is unavailable/);

  const rejected = createCognitoGetUserProvider({
    region: 'us-east-1',
    async fetchImpl() { return { ok: false, status: 401, async json() { return { message: 'token-value' }; } }; },
  });
  await assert.rejects(() => rejected('token-value'), /identity provider rejected the session/);

  const invalidJson = createCognitoGetUserProvider({
    region: 'us-east-1',
    async fetchImpl() { return { ok: true, async json() { throw new Error('bad json'); } }; },
  });
  await assert.rejects(() => invalidJson('token-value'), /returned an invalid response/);

  const invalidBody = createCognitoGetUserProvider({
    region: 'us-east-1',
    async fetchImpl() { return okResponse([]); },
  });
  await assert.rejects(() => invalidBody('token-value'), /returned an invalid response/);
});

test('GetUser timeout is bounded', () => {
  const fetchImpl = async () => okResponse(cognitoUser());
  assert.throws(
    () => createCognitoGetUserProvider({ region: 'us-east-1', fetchImpl, timeoutMs: 100 }),
    /timeout must be between 250 and 15000/,
  );
  assert.throws(
    () => createCognitoGetUserProvider({ region: 'us-east-1', fetchImpl, timeoutMs: 16000 }),
    /timeout must be between 250 and 15000/,
  );
});

test('Cognito workspace resolver maps a real GetUser-shaped response into the shared actor contract', async () => {
  const resolver = createCognitoWorkspaceResolver({
    region: 'us-east-1',
    async fetchImpl() { return okResponse(cognitoUser()); },
  });
  const actor = await resolver({ get(name) { return name === 'authorization' ? 'Bearer opaque-token' : undefined; } });
  assert.deepEqual(actor, {
    tenantId: 'tenant-a',
    principalId: 'principal-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner One',
  });
});
