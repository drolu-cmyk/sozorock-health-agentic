const { createCognitoWorkspaceIdentityResolver } = require('./cognito-workspace-identity');

const REGION = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d$/;
const APP_CLIENT_ID = /^[A-Za-z0-9]{1,128}$/;
const COGNITO_TARGET = 'AWSCognitoIdentityProviderService.GetUser';

function normalizedRegion(value) {
  if (typeof value !== 'string' || !REGION.test(value.trim())) {
    throw new Error('A valid AWS region is required for Cognito workspace identity.');
  }
  return value.trim();
}

function cognitoHost(regionInput) {
  const region = normalizedRegion(regionInput);
  const suffix = region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com';
  return `cognito-idp.${region}.${suffix}`;
}

function cognitoEndpoint(region) {
  return `https://${cognitoHost(region)}/`;
}

function userPoolId(value, regionInput) {
  const region = normalizedRegion(regionInput);
  const normalized = typeof value === 'string' ? value.trim() : '';
  const pattern = new RegExp(`^${region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_[A-Za-z0-9]+$`);
  if (!pattern.test(normalized)) {
    throw new Error('A valid Cognito user pool ID is required for workspace identity.');
  }
  return normalized;
}

function appClientId(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!APP_CLIENT_ID.test(normalized)) {
    throw new Error('A valid Cognito app client ID is required for workspace identity.');
  }
  return normalized;
}

function cognitoIssuer(regionInput, poolInput) {
  const region = normalizedRegion(regionInput);
  const pool = userPoolId(poolInput, region);
  return `https://${cognitoHost(region)}/${pool}`;
}

function accessToken(value) {
  if (typeof value !== 'string') throw new Error('A valid Cognito access token is required.');
  const token = value.trim();
  if (!token || token.length > 8192 || /\s/.test(token)) {
    throw new Error('A valid Cognito access token is required.');
  }
  return token;
}

function decodeTokenClaims(tokenInput) {
  const token = accessToken(tokenInput);
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('Cognito workspace identity provider rejected the session.');
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Cognito workspace identity provider rejected the session.');
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new Error('Cognito workspace identity provider rejected the session.');
  }
  return claims;
}

function validateTokenBoundary(tokenInput, expected = {}) {
  const claims = decodeTokenClaims(tokenInput);
  if (claims.token_use !== 'access'
    || claims.iss !== expected.issuer
    || claims.client_id !== expected.appClientId) {
    throw new Error('Cognito workspace identity provider rejected the session.');
  }
  return claims;
}

function createCognitoGetUserProvider(options = {}) {
  const region = normalizedRegion(options.region || process.env.AWS_REGION || '');
  const expectedPoolId = userPoolId(options.userPoolId || process.env.CB_CAP_COGNITO_USER_POOL_ID || '', region);
  const expectedAppClientId = appClientId(options.appClientId || process.env.CB_CAP_COGNITO_APP_CLIENT_ID || '');
  const endpoint = cognitoEndpoint(region);
  const issuer = cognitoIssuer(region, expectedPoolId);
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Cognito GetUser provider requires fetch support.');
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 5000;
  if (timeoutMs < 250 || timeoutMs > 15000) throw new Error('Cognito GetUser timeout must be between 250 and 15000 milliseconds.');

  return async function getUser(tokenInput) {
    const token = accessToken(tokenInput);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': COGNITO_TARGET,
        },
        body: JSON.stringify({ AccessToken: token }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('Cognito workspace identity provider is unavailable.');
    }
    if (!response?.ok) {
      throw new Error('Cognito workspace identity provider rejected the session.');
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('Cognito workspace identity provider returned an invalid response.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Cognito workspace identity provider returned an invalid response.');
    }

    // GetUser has already authenticated the token with Cognito. Bind that
    // authenticated JWT to the exact CB-CAP user pool and application client
    // before its custom attributes may become workspace authority.
    validateTokenBoundary(token, { issuer, appClientId: expectedAppClientId });
    return body;
  };
}

function createCognitoWorkspaceResolver(options = {}) {
  return createCognitoWorkspaceIdentityResolver({
    getUser: createCognitoGetUserProvider(options),
  });
}

module.exports = {
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
};
