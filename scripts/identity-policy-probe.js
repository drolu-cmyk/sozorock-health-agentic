#!/usr/bin/env node

const { permissionDecision } = require('../packages/runtime/workspace-identity');
const { createCognitoWorkspaceIdentityResolver } = require('../server/cognito-workspace-identity');

async function runIdentityPolicyProbe() {
  const planner = {
    tenantId: 'tenant-a',
    principalId: 'planner-a',
    role: 'county_planner',
    access: 'owner',
    actorType: 'human',
    displayName: 'Planner A',
  };
  const agent = {
    tenantId: 'tenant-a',
    principalId: 'agent-a',
    role: 'evidence_agent',
    access: 'contributor',
    actorType: 'agent',
    displayName: 'Evidence Agent A',
  };
  const viewer = {
    tenantId: 'tenant-a',
    principalId: 'viewer-a',
    role: 'research_funder_viewer',
    access: 'viewer',
    actorType: 'human',
    displayName: 'Viewer A',
  };

  const resolver = createCognitoWorkspaceIdentityResolver({
    async getUser(token) {
      if (token !== 'valid-access-token') throw new Error('invalid token');
      return {
        Username: 'planner-a',
        UserAttributes: [
          { Name: 'custom:tenant_id', Value: 'tenant-a' },
          { Name: 'custom:workspace_role', Value: 'county_planner' },
          { Name: 'custom:workspace_access', Value: 'owner' },
          { Name: 'email', Value: 'planner@example.invalid' },
        ],
      };
    },
  });
  const resolved = await resolver({
    headers: {
      authorization: 'Bearer valid-access-token',
      'x-tenant-id': 'tenant-b',
      'x-workspace-role': 'foundation_reviewer',
    },
  });

  const result = {
    sameTenantAuthorized: permissionDecision(planner, 'cbcap.plan.create').ok === true,
    humanReviewAuthorityVerified:
      permissionDecision(planner, 'cbcap.plan.review').ok === true
      && permissionDecision(agent, 'cbcap.plan.review').ok === false
      && permissionDecision(viewer, 'cbcap.plan.review').ok === false,
    callerTenantOverrideIgnored: resolved.tenantId === 'tenant-a' && resolved.role === 'county_planner',
    agentCannotCreatePlan: permissionDecision(agent, 'cbcap.plan.create').ok === false,
    viewerCannotCreatePlan: permissionDecision(viewer, 'cbcap.plan.create').ok === false,
  };
  result.ok = Object.values(result).every(Boolean);
  return result;
}

if (require.main === module) {
  runIdentityPolicyProbe().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(error?.message || 'Identity policy probe failed.');
    process.exitCode = 1;
  });
}

module.exports = { runIdentityPolicyProbe };
