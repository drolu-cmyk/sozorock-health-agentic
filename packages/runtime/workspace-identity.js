const WORKSPACE_ROLES = Object.freeze([
  'foundation_reviewer',
  'county_planner',
  'community_partner',
  'research_funder_viewer',
  'evidence_agent',
]);

const WORKSPACE_ACCESS = Object.freeze(['owner', 'contributor', 'viewer']);

const HUMAN_ROLES = new Set([
  'foundation_reviewer',
  'county_planner',
  'community_partner',
  'research_funder_viewer',
]);

const PLAN_CREATE_ROLES = new Set([
  'foundation_reviewer',
  'county_planner',
  'community_partner',
]);

const PLAN_REVIEW_ROLES = new Set([
  'foundation_reviewer',
  'county_planner',
]);

const FUNDING_EVALUATE_ROLES = new Set([
  'foundation_reviewer',
  'county_planner',
  'community_partner',
  'research_funder_viewer',
]);

const WRITE_ACCESS = new Set(['owner', 'contributor']);

function requiredString(value, label, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function validateWorkspaceActor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workspace actor must be an object.');
  }
  const tenantId = requiredString(value.tenantId, 'actor.tenantId', 200);
  const principalId = requiredString(value.principalId, 'actor.principalId', 200);
  const role = requiredString(value.role, 'actor.role', 80);
  const access = requiredString(value.access, 'actor.access', 40);
  const displayName = requiredString(value.displayName || principalId, 'actor.displayName', 240);

  if (!WORKSPACE_ROLES.includes(role)) throw new Error('actor.role is not an approved workspace role.');
  if (!WORKSPACE_ACCESS.includes(access)) throw new Error('actor.access is not an approved workspace access level.');

  const expectedType = role === 'evidence_agent' ? 'agent' : 'human';
  if (value.actorType !== undefined && value.actorType !== expectedType) {
    throw new Error('actor.actorType does not match the approved workspace role.');
  }

  return Object.freeze({
    tenantId,
    principalId,
    actorType: expectedType,
    role,
    access,
    displayName,
  });
}

function permissionDecision(actorInput, action) {
  let actor;
  try {
    actor = validateWorkspaceActor(actorInput);
  } catch {
    return { ok: false, code: 'invalid_actor' };
  }

  if ([
    'cbcap.plan.view',
    'cbcap.visualization.plan',
    'cbcap.monitoring.evaluate',
    'cbcap.workforce.view',
    'cbcap.workspace.read',
    'cbcap.memory.read',
  ].includes(action)) {
    return { ok: true, actor };
  }
  if (action === 'cbcap.funding.evaluate') {
    if (actor.actorType !== 'human') return { ok: false, code: 'human_required', actor };
    if (!FUNDING_EVALUATE_ROLES.has(actor.role)) return { ok: false, code: 'role_not_allowed', actor };
    return { ok: true, actor };
  }
  if (action === 'cbcap.plan.create' || action === 'cbcap.workspace.write' || action === 'cbcap.memory.propose') {
    if (actor.actorType !== 'human') return { ok: false, code: 'human_required', actor };
    if (!WRITE_ACCESS.has(actor.access)) return { ok: false, code: 'write_access_required', actor };
    if (!PLAN_CREATE_ROLES.has(actor.role)) return { ok: false, code: 'role_not_allowed', actor };
    return { ok: true, actor };
  }
  if (action === 'cbcap.plan.review' || action === 'cbcap.memory.review') {
    if (actor.actorType !== 'human') return { ok: false, code: 'human_required', actor };
    if (!WRITE_ACCESS.has(actor.access)) return { ok: false, code: 'write_access_required', actor };
    if (!PLAN_REVIEW_ROLES.has(actor.role)) return { ok: false, code: 'role_not_allowed', actor };
    return { ok: true, actor };
  }

  return { ok: false, code: 'unknown_action', actor };
}

module.exports = {
  FUNDING_EVALUATE_ROLES,
  HUMAN_ROLES,
  PLAN_CREATE_ROLES,
  PLAN_REVIEW_ROLES,
  WORKSPACE_ACCESS,
  WORKSPACE_ROLES,
  permissionDecision,
  validateWorkspaceActor,
};