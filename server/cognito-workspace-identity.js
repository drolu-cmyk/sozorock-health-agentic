const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

function authorizationHeader(request) {
  if (!request) return '';
  if (typeof request.get === 'function') return String(request.get('authorization') || '').trim();
  if (request.headers && typeof request.headers.get === 'function') {
    return String(request.headers.get('authorization') || '').trim();
  }
  if (request.headers && typeof request.headers === 'object') {
    const value = request.headers.authorization || request.headers.Authorization || '';
    return Array.isArray(value) ? String(value[0] || '').trim() : String(value).trim();
  }
  return '';
}

function bearerToken(request) {
  const header = authorizationHeader(request);
  if (!header.startsWith('Bearer ')) throw new Error('A valid authenticated workspace session is required.');
  const token = header.slice(7).trim();
  if (!token || token.length > 8192 || /\s/.test(token)) {
    throw new Error('A valid authenticated workspace session is required.');
  }
  return token;
}

function attributeMap(user) {
  const values = new Map();
  for (const attribute of user?.UserAttributes || []) {
    if (!attribute || typeof attribute !== 'object') continue;
    const name = typeof attribute.Name === 'string' ? attribute.Name.trim() : '';
    const value = typeof attribute.Value === 'string' ? attribute.Value.trim() : '';
    if (name && value) values.set(name, value);
  }
  return values;
}

function actorFromCognitoUser(user) {
  const attributes = attributeMap(user);
  const tenantId = attributes.get('custom:tenant_id');
  const role = attributes.get('custom:workspace_role');
  const access = attributes.get('custom:workspace_access');
  const principalId = typeof user?.Username === 'string' ? user.Username.trim() : '';
  const displayName = attributes.get('name') || attributes.get('email') || principalId;
  return validateWorkspaceActor({
    tenantId,
    principalId,
    role,
    access,
    actorType: role === 'evidence_agent' ? 'agent' : 'human',
    displayName,
  });
}

function createCognitoWorkspaceIdentityResolver(options = {}) {
  if (typeof options.getUser !== 'function') {
    throw new Error('Cognito workspace identity resolver requires getUser(accessToken).');
  }

  return async function resolveWorkspaceIdentity(request) {
    const token = bearerToken(request);
    let user;
    try {
      user = await options.getUser(token);
    } catch {
      throw new Error('A valid authenticated workspace session is required.');
    }
    try {
      return actorFromCognitoUser(user);
    } catch {
      throw new Error('The authenticated account does not have a complete county-workspace assignment.');
    }
  };
}

module.exports = {
  actorFromCognitoUser,
  authorizationHeader,
  bearerToken,
  createCognitoWorkspaceIdentityResolver,
};
