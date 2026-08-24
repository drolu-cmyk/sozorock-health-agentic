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

test('evidence agents may run nonconsequential monitoring but cannot create, review, or evaluate institutional funding fit', () => {
  const evidenceAgent = actor({
    principalId: 'agent-1',
    role: 'evidence_agent',
    actorType: 'agent',
    access: 'contributor',
  });
  assert.equal(permissionDecision(evidenceAgent, 'cbcap.plan.view').ok, true);
  assert.equal(permissionDecision(evidenceAgent, 'cbcap.monitoring.evaluate').ok, true);
  assert.equal(permissionDecision(evidenceAgent, 'cbcap.plan.create').ok, false);
  assert.equal(permissionDecision(evidenceAgent, 'cbcap.plan.review').ok, false);
  assert.equal(permissionDecision(evidenceAgent, 'cbcap.funding.evaluate').ok, false);
});

test('county planners and foundation reviewers with write access may review', () => {
  assert.equal(permissionDecision(actor(), 'cbcap.plan.review').ok, true);
  assert.equal(permissionDecision(actor({ role: 'foundation_reviewer', access: 'owner' }), 'cbcap.plan.review').ok, true);
});

test('community partners may contribute planning work but cannot approve it', () => {
  const partner = actor({ role: 'community_partner' });
  assert.equal(permissionDecision(partner, 'cbcap.plan.create').ok, true);
  assert.equal(permissionDecision(partner, 'cbcap.plan.review').ok, false);
  assert.equal(permissionDecision(partner, 'cbcap.monitoring.evaluate').ok, true);
});

test('human tenant members may run read-only funding evidence matching and monitoring even with viewer access', () => {
  for (const role of ['foundation_reviewer', 'county_planner', 'community_partner', 'research_funder_viewer']) {
    const funding = permissionDecision(actor({ role, access: 'viewer' }), 'cbcap.funding.evaluate');
    assert.equal(funding.ok, true, `${role} should be able to evaluate read-only funding fit`);
    const monitoring = permissionDecision(actor({ role, access: 'viewer' }), 'cbcap.monitoring.evaluate');
    assert.equal(monitoring.ok, true, `${role} should be able to evaluate nonconsequential monitoring`);
  }
});

test('research funder viewers and viewer access remain unable to change planning state', () => {
  const funder = actor({ role: 'research_funder_viewer', access: 'viewer' });
  assert.equal(permissionDecision(funder, 'cbcap.plan.view').ok, true);
  assert.equal(permissionDecision(funder, 'cbcap.plan.create').ok, false);
  assert.equal(permissionDecision(funder, 'cbcap.plan.review').ok, false);
  assert.equal(permissionDecision(funder, 'cbcap.funding.evaluate').ok, true);
  assert.equal(permissionDecision(funder, 'cbcap.monitoring.evaluate').ok, true);

  const viewerPlanner = actor({ access: 'viewer' });
  assert.equal(permissionDecision(viewerPlanner, 'cbcap.plan.create').ok, false);
  assert.equal(permissionDecision(viewerPlanner, 'cbcap.plan.review').ok, false);
  assert.equal(permissionDecision(viewerPlanner, 'cbcap.funding.evaluate').ok, true);
  assert.equal(permissionDecision(viewerPlanner, 'cbcap.monitoring.evaluate').ok, true);
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
