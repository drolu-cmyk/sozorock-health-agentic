const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COGNITO_TARGET,
  accessToken,
  appClientId,
  cognitoEndpoint,
  cognitoIssuer,
  createCognitoGetUserProvider,
  createCognitoWorkspaceResolver,
  decodeTokenClaims,
  userPoolId,
  validateTokenBoundary,
} = require('../server/cognito-get-user-provider');

const REGION = 'us-east-1';
const USER_POOL_ID = 'us-east-1_Example123';
const APP_CLIENT_ID = '4exampleclient123';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

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

function jwt(payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    token_use: 'access',
    client_id: APP_CLIENT_ID,
    iss: ISSUER,
    ...payload,
  })).toString('base64url');
  return `${header}.${body}.test-signature`;
}

function providerOptions(overrides = {}) {
  return {
    region: REGION,
    userPoolId: USER_POOL_ID,
    appClientId: APP_CLIENT_ID,
    ...overrides,
  };
}

test('Cognito endpoint and issuer are region and user-pool scoped', () => {
  assert.equal(cognitoEndpoint('us-east-1'), 'https://cognito-idp.us-east-1.amazonaws.com/');
  assert.equal(cognitoEndpoint('us-gov-west-1'), 'https://cognito-idp.us-gov-west-1.amazonaws.com/');
  assert.equal(cognitoEndpoint('cn-north-1'), 'https://cognito-idp.cn-north-1.amazonaws.com.cn/');
  assert.equal(cognitoIssuer(REGION, USER_POOL_ID), ISSUER);
  assert.throws(() => cognitoEndpoint(''), /valid AWS region/);
  assert.throws(() => cognitoEndpoint('https://example.com'), /valid AWS region/);
  assert.throws(() => userPoolId('eu-west-1_Other', REGION), /valid Cognito user pool ID/);
  assert.equal(userPoolId(USER_POOL_ID, REGION), USER_POOL_ID);
  assert.equal(appClientId(APP_CLIENT_ID), APP_CLIENT_ID);
  assert.throws(() => appClientId('client with spaces'), /valid Cognito app client ID/);
});

test('access token validation rejects empty, oversized, and whitespace-bearing tokens', () => {
  assert.equal(accessToken('opaque-token'), 'opaque-token');
  assert.throws(() => accessToken(''), /valid Cognito access token/);
  assert.throws(() => accessToken('token with spaces'), /valid Cognito access token/);
  assert.throws(() => accessToken('x'.repeat(8193)), /valid Cognito access token/);
});

test('JWT boundary decoder accepts only the exact CB-CAP access-token scope', () => {
  const token = jwt();
  assert.equal(decodeTokenClaims(token).client_id, APP_CLIENT_ID);
  assert.equal(validateTokenBoundary(token, { issuer: ISSUER, appClientId: APP_CLIENT_ID }).token_use, 'access');
  assert.throws(
    () => validateTokenBoundary(jwt({ iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other' }), { issuer: ISSUER, appClientId: APP_CLIENT_ID }),
    /rejected the session/,
  );
  assert.throws(
    () => validateTokenBoundary(jwt({ client_id: 'otherclient123' }), { issuer: ISSUER, appClientId: APP_CLIENT_ID }),
    /rejected the session/,
  );
  assert.throws(
    () => validateTokenBoundary(jwt({ token_use: 'id' }), { issuer: ISSUER, appClientId: APP_CLIENT_ID }),
    /rejected the session/,
  );
  assert.throws(() => decodeTokenClaims('opaque-token'), /rejected the session/);
});

test('GetUser provider requires an exact pool and app client boundary', () => {
  const fetchImpl = async () => okResponse(cognitoUser());
  assert.throws(
    () => createCognitoGetUserProvider({ region: REGION, appClientId: APP_CLIENT_ID, fetchImpl }),
    /valid Cognito user pool ID/,
  );
  assert.throws(
    () => createCognitoGetUserProvider({ region: REGION, userPoolId: USER_POOL_ID, fetchImpl }),
    /valid Cognito app client ID/,
  );
  assert.throws(
    () => createCognitoGetUserProvider({ region: REGION, userPoolId: 'eu-west-1_Other', appClientId: APP_CLIENT_ID, fetchImpl }),
    /valid Cognito user pool ID/,
  );
});

test('GetUser provider sends the exact AWS JSON protocol without returning the token', async () => {
  const calls = [];
  const token = jwt();
  const getUser = createCognitoGetUserProvider(providerOptions({
    timeoutMs: 1000,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return okResponse(cognitoUser());
    },
  }));

  const value = await getUser(token);
  assert.equal(value.Username, 'principal-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://cognito-idp.us-east-1.amazonaws.com/');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-amz-json-1.1');
  assert.equal(calls[0].options.headers['X-Amz-Target'], COGNITO_TARGET);
  assert.deepEqual(JSON.parse(calls[0].options.body), { AccessToken: token });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(value).includes(token), false);
});

test('GetUser provider rejects a valid Cognito response when JWT scope is wrong or malformed', async () => {
  const getUser = createCognitoGetUserProvider(providerOptions({
    async fetchImpl() { return okResponse(cognitoUser()); },
  }));
  await assert.rejects(() => getUser(jwt({ client_id: 'otherclient123' })), /rejected the session/);
  await assert.rejects(() => getUser(jwt({ iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other' })), /rejected the session/);
  await assert.rejects(() => getUser(jwt({ token_use: 'id' })), /rejected the session/);
  await assert.rejects(() => getUser('opaque-token'), /rejected the session/);
});

test('GetUser provider sanitizes network, rejection, and response parsing failures', async () => {
  const unavailable = createCognitoGetUserProvider(providerOptions({
    async fetchImpl() { throw new Error('socket secret detail'); },
  }));
  await assert.rejects(() => unavailable(jwt()), /identity provider is unavailable/);

  const rejected = createCognitoGetUserProvider(providerOptions({
    async fetchImpl() { return { ok: false, status: 401, async json() { return { message: 'token-value' }; } }; },
  }));
  await assert.rejects(() => rejected(jwt()), /identity provider rejected the session/);

  const invalidJson = createCognitoGetUserProvider(providerOptions({
    async fetchImpl() { return { ok: true, async json() { throw new Error('bad json'); } }; },
  }));
  await assert.rejects(() => invalidJson(jwt()), /returned an invalid response/);

  const invalidBody = createCognitoGetUserProvider(providerOptions({
    async fetchImpl() { return okResponse([]); },
  }));
  await assert.rejects(() => invalidBody(jwt()), /returned an invalid response/);
});

test('GetUser timeout is bounded', () => {
  const fetchImpl = async () => okResponse(cognitoUser());
  assert.throws(
    () => createCognitoGetUserProvider(providerOptions({ fetchImpl, timeoutMs: 100 })),
    /timeout must be between 250 and 15000/,
  );
  assert.throws(
    () => createCognitoGetUserProvider(providerOptions({ fetchImpl, timeoutMs: 16000 })),
    /timeout must be between 250 and 15000/,
  );
});

test('Cognito workspace resolver maps a bound GetUser response into the shared actor contract', async () => {
  const resolver = createCognitoWorkspaceResolver(providerOptions({
    async fetchImpl() { return okResponse(cognitoUser()); },
  }));
  const token = jwt();
  const actor = await resolver({ get(name) { return name === 'authorization' ? `Bearer ${token}` : undefined; } });
  assert.deepEqual(actor, {
    tenantId: 'tenant-a',
    principalId: 'principal-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner One',
  });
});
