const test = require('node:test');
const assert = require('node:assert/strict');
const {
  permissionDecision,
  validateWorkspaceActor,
} = require('../packages/runtime/workspace-identity');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'principal-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner One',
    ...overrides,
  };
}

test('workspace actor contract preserves the existing collaboration taxonomy', () => {
  const value = validateWorkspaceActor(actor());
  assert.deepEqual(value, {
    tenantId: 'tenant-a',
    principalId: 'principal-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner One',
  });
});

test('evidence agents are machine actors and cannot create or review plans', () => {
  const evidenceAgent = actor({
    principalId: 'agent-1',
    role: 'evidence_agent',
    actorType: 'agent',
    access: 'contributor',
  });
  assert.equal(permissionDecision(evidenceAgent, 'cbcap.plan.view').ok, true);
  assert.equal(permissionDecision(evidenceAgent, 'cbcap.plan.create').ok, false);
  assert.equal(permissionDecision(evidenceAgent, 'cbcap.plan.review').ok, false);
});

test('county planners and foundation reviewers with write access may review', () => {
  assert.equal(permissionDecision(actor(), 'cbcap.plan.review').ok, true);
  assert.equal(permissionDecision(actor({ role: 'foundation_reviewer', access: 'owner' }), 'cbcap.plan.review').ok, true);
});

test('community partners may contribute planning work but cannot approve it', () => {
  const partner = actor({ role: 'community_partner' });
  assert.equal(permissionDecision(partner, 'cbcap.plan.create').ok, true);
  assert.equal(permissionDecision(partner, 'cbcap.plan.review').ok, false);
});

test('research funder viewers and viewer access remain read-only', () => {
  const funder = actor({ role: 'research_funder_viewer', access: 'viewer' });
  assert.equal(permissionDecision(funder, 'cbcap.plan.view').ok, true);
  assert.equal(permissionDecision(funder, 'cbcap.plan.create').ok, false);
  assert.equal(permissionDecision(funder, 'cbcap.plan.review').ok, false);

  const viewerPlanner = actor({ access: 'viewer' });
  assert.equal(permissionDecision(viewerPlanner, 'cbcap.plan.create').ok, false);
  assert.equal(permissionDecision(viewerPlanner, 'cbcap.plan.review').ok, false);
});

test('incomplete or mismatched actor assignments fail closed', () => {
  assert.throws(() => validateWorkspaceActor(actor({ tenantId: '' })), /tenantId is required/);
  assert.throws(() => validateWorkspaceActor(actor({ role: 'unknown_role' })), /approved workspace role/);
  assert.throws(
    () => validateWorkspaceActor(actor({ role: 'evidence_agent', actorType: 'human' })),
    /actorType does not match/,
  );
  assert.equal(permissionDecision(actor(), 'unknown.action').ok, false);
});
