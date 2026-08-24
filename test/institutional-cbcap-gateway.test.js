const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInstitutionalCBCAPGateway,
  workspaceActorReviewAuthorizer,
} = require('../server/institutional-cbcap-gateway');

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

function fixture(options = {}) {
  const calls = { identity: 0, runtime: [], plan: 0, review: 0, funding: 0, reviewContext: null, fundingContext: null };
  const identityResolver = async () => {
    calls.identity += 1;
    if (options.identityError) throw new Error('invalid session');
    return options.actor || actor();
  };
  const runtimeForActor = async (resolvedActor) => {
    calls.runtime.push(structuredClone(resolvedActor));
    if (options.runtimeUnavailable) return null;
    return {
      planningApi: {
        async handle(input) {
          calls.plan += 1;
          return { statusCode: 202, body: { status: 'awaiting_human_review', tenantSeen: resolvedActor.tenantId, input } };
        },
      },
      reviewApi: options.noReview ? null : {
        async handle(runId, input, context) {
          calls.review += 1;
          calls.reviewContext = structuredClone({
            workspaceActor: context.workspaceActor,
            hasRequest: Boolean(context.request),
          });
          return { statusCode: 200, body: { status: 'approved_output', runId, input } };
        },
      },
      fundingApi: options.noFunding ? null : {
        async handle(input, context) {
          calls.funding += 1;
          calls.fundingContext = structuredClone({
            workspaceActor: context.workspaceActor,
            hasRequest: Boolean(context.request),
          });
          return { statusCode: 200, body: { status: 'provisional_review_required', opportunityId: input.opportunityId } };
        },
      },
    };
  };
  return {
    calls,
    gateway: createInstitutionalCBCAPGateway({ identityResolver, runtimeForActor }),
  };
}

test('plan request authenticates before selecting the actor tenant runtime', async () => {
  const { gateway, calls } = fixture();
  const result = await gateway.handlePlan({ location: '36001' }, { request: { id: 'req-1' } });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.tenantSeen, 'tenant-a');
  assert.equal(calls.identity, 1);
  assert.equal(calls.plan, 1);
  assert.equal(calls.runtime.length, 1);
  assert.equal(calls.runtime[0].tenantId, 'tenant-a');
});

test('review request requires review role and passes authenticated actor into review context', async () => {
  const { gateway, calls } = fixture();
  const result = await gateway.handleReview('run-1', { decision: 'approve' }, { request: { id: 'req-1' } });
  assert.equal(result.statusCode, 200);
  assert.equal(calls.review, 1);
  assert.equal(calls.reviewContext.workspaceActor.principalId, 'principal-1');
  assert.equal(calls.reviewContext.workspaceActor.tenantId, 'tenant-a');
  assert.equal(calls.reviewContext.hasRequest, true);
});

test('funding request authenticates before selecting tenant runtime and passes trusted actor context', async () => {
  const { gateway, calls } = fixture({ actor: actor({ role: 'research_funder_viewer', access: 'viewer' }) });
  const result = await gateway.handleFunding({ opportunityId: 'opp-1', countyId: 'county:36001' }, { request: { id: 'req-funding' } });
  assert.equal(result.statusCode, 200);
  assert.equal(calls.funding, 1);
  assert.equal(calls.fundingContext.workspaceActor.tenantId, 'tenant-a');
  assert.equal(calls.fundingContext.workspaceActor.role, 'research_funder_viewer');
  assert.equal(calls.fundingContext.hasRequest, true);
});

test('unauthenticated request fails before runtime selection', async () => {
  const { gateway, calls } = fixture({ identityError: true });
  const result = await gateway.handlePlan({ location: '36001' }, { request: {} });
  assert.equal(result.statusCode, 403);
  assert.equal(calls.runtime.length, 0);
  assert.equal(calls.plan, 0);
});

test('viewer and evidence-agent actors cannot create institutional plans', async () => {
  for (const deniedActor of [
    actor({ access: 'viewer' }),
    actor({ principalId: 'agent-1', role: 'evidence_agent', actorType: 'agent' }),
  ]) {
    const { gateway, calls } = fixture({ actor: deniedActor });
    const result = await gateway.handlePlan({ location: '36001' }, { request: {} });
    assert.equal(result.statusCode, 403);
    assert.equal(calls.runtime.length, 0);
  }
});

test('evidence agent cannot evaluate institutional funding fit', async () => {
  const { gateway, calls } = fixture({
    actor: actor({ principalId: 'agent-1', role: 'evidence_agent', actorType: 'agent' }),
  });
  const result = await gateway.handleFunding({ opportunityId: 'opp-1', countyId: 'county:36001' }, { request: {} });
  assert.equal(result.statusCode, 403);
  assert.equal(calls.funding, 0);
  assert.equal(calls.runtime.length, 0);
});

test('community partner can create a plan but cannot approve it', async () => {
  const { gateway, calls } = fixture({ actor: actor({ role: 'community_partner' }) });
  const plan = await gateway.handlePlan({ location: '36001' }, { request: {} });
  assert.equal(plan.statusCode, 202);
  const review = await gateway.handleReview('run-1', { decision: 'approve' }, { request: {} });
  assert.equal(review.statusCode, 403);
  assert.equal(calls.review, 0);
});

test('runtime unavailability is sanitized', async () => {
  const { gateway } = fixture({ runtimeUnavailable: true });
  const result = await gateway.handlePlan({ location: '36001' }, { request: {} });
  assert.equal(result.statusCode, 503);
  assert.match(result.body.error, /not available for this workspace/);
});

test('review unavailable for a tenant returns service unavailable rather than falling back', async () => {
  const { gateway, calls } = fixture({ noReview: true });
  const result = await gateway.handleReview('run-1', { decision: 'approve' }, { request: {} });
  assert.equal(result.statusCode, 503);
  assert.equal(calls.review, 0);
});

test('funding unavailable for a tenant returns service unavailable rather than accepting client data', async () => {
  const { gateway, calls } = fixture({ noFunding: true });
  const result = await gateway.handleFunding({ opportunityId: 'opp-1', countyId: 'county:36001' }, { request: {} });
  assert.equal(result.statusCode, 503);
  assert.equal(calls.funding, 0);
});

test('workspace actor review authorizer derives subject and tenant from trusted context', () => {
  const result = workspaceActorReviewAuthorizer({ workspaceActor: actor() });
  assert.deepEqual(result, {
    subject: 'principal-1',
    tenantId: 'tenant-a',
    role: 'county_planner',
    access: 'contributor',
  });
  assert.throws(
    () => workspaceActorReviewAuthorizer({ workspaceActor: actor({ role: 'community_partner' }) }),
    /Review authorization failed/,
  );
});
