const { createCognitoWorkspaceIdentityResolver } = require('./cognito-workspace-identity');

const REGION = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d$/;
const COGNITO_TARGET = 'AWSCognitoIdentityProviderService.GetUser';

function cognitoEndpoint(region) {
  if (typeof region !== 'string' || !REGION.test(region.trim())) {
    throw new Error('A valid AWS region is required for Cognito workspace identity.');
  }
  const normalized = region.trim();
  const suffix = normalized.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com';
  return `https://cognito-idp.${normalized}.${suffix}/`;
}

function accessToken(value) {
  if (typeof value !== 'string') throw new Error('A valid Cognito access token is required.');
  const token = value.trim();
  if (!token || token.length > 8192 || /\s/.test(token)) {
    throw new Error('A valid Cognito access token is required.');
  }
  return token;
}

function createCognitoGetUserProvider(options = {}) {
  const endpoint = cognitoEndpoint(options.region || process.env.AWS_REGION || '');
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
  cognitoEndpoint,
  createCognitoGetUserProvider,
  createCognitoWorkspaceResolver,
};
