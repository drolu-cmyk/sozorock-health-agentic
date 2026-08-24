const { permissionDecision } = require('../packages/runtime/workspace-identity');

function forbidden() {
  return { statusCode: 403, body: { error: 'Institutional CB-CAP authorization failed.' } };
}

function unavailable() {
  return { statusCode: 503, body: { error: 'Institutional CB-CAP runtime is not available for this workspace.' } };
}

function createInstitutionalCBCAPGateway(options = {}) {
  if (typeof options.identityResolver !== 'function') {
    throw new Error('Institutional CB-CAP gateway requires an identity resolver.');
  }
  if (typeof options.runtimeForActor !== 'function') {
    throw new Error('Institutional CB-CAP gateway requires runtimeForActor(actor).');
  }
  const identityResolver = options.identityResolver;
  const runtimeForActor = options.runtimeForActor;
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};

  async function actorFor(request, action) {
    let actor;
    try {
      actor = await identityResolver(request);
    } catch {
      return { error: forbidden() };
    }
    const decision = permissionDecision(actor, action);
    if (!decision.ok) {
      auditSink({
        action: 'cbcap_access_denied',
        requestedAction: action,
        tenantId: actor?.tenantId || null,
        principalId: actor?.principalId || null,
        role: actor?.role || null,
        access: actor?.access || null,
        reason: decision.code,
      });
      return { error: forbidden() };
    }
    return { actor: decision.actor };
  }

  async function runtime(actor) {
    try {
      const value = await runtimeForActor(actor);
      if (!value || typeof value !== 'object') return null;
      return value;
    } catch {
      return null;
    }
  }

  return {
    async handlePlan(input, context = {}) {
      const auth = await actorFor(context.request, 'cbcap.plan.create');
      if (auth.error) return auth.error;
      const selected = await runtime(auth.actor);
      if (!selected?.planningApi || typeof selected.planningApi.handle !== 'function') return unavailable();

      const result = await selected.planningApi.handle(input || {});
      auditSink({
        action: 'cbcap_plan_request_completed',
        tenantId: auth.actor.tenantId,
        principalId: auth.actor.principalId,
        role: auth.actor.role,
        statusCode: result.statusCode,
        runId: result.body?.runId || null,
      });
      return result;
    },

    async handleReview(runId, input, context = {}) {
      const auth = await actorFor(context.request, 'cbcap.plan.review');
      if (auth.error) return auth.error;
      const selected = await runtime(auth.actor);
      if (!selected?.reviewApi || typeof selected.reviewApi.handle !== 'function') return unavailable();

      const result = await selected.reviewApi.handle(runId, input || {}, {
        ...context,
        workspaceActor: auth.actor,
      });
      auditSink({
        action: 'cbcap_review_request_completed',
        tenantId: auth.actor.tenantId,
        principalId: auth.actor.principalId,
        role: auth.actor.role,
        runId,
        statusCode: result.statusCode,
      });
      return result;
    },

    async handleFunding(input, context = {}) {
      const auth = await actorFor(context.request, 'cbcap.funding.evaluate');
      if (auth.error) return auth.error;
      const selected = await runtime(auth.actor);
      if (!selected?.fundingApi || typeof selected.fundingApi.handle !== 'function') return unavailable();

      const result = await selected.fundingApi.handle(input || {}, {
        ...context,
        workspaceActor: auth.actor,
      });
      auditSink({
        action: 'cbcap_funding_request_completed',
        tenantId: auth.actor.tenantId,
        principalId: auth.actor.principalId,
        role: auth.actor.role,
        opportunityId: result.body?.opportunityId || null,
        statusCode: result.statusCode,
      });
      return result;
    },

    async handleVisualization(input, context = {}) {
      const auth = await actorFor(context.request, 'cbcap.visualization.plan');
      if (auth.error) return auth.error;
      const selected = await runtime(auth.actor);
      if (!selected?.visualizationApi || typeof selected.visualizationApi.handle !== 'function') return unavailable();

      const result = await selected.visualizationApi.handle(input || {}, {
        ...context,
        workspaceActor: auth.actor,
      });
      auditSink({
        action: 'cbcap_visualization_request_completed',
        tenantId: auth.actor.tenantId,
        principalId: auth.actor.principalId,
        role: auth.actor.role,
        question: result.body?.question || null,
        artifactFamily: result.body?.artifactFamily || null,
        statusCode: result.statusCode,
      });
      return result;
    },
  };
}

function workspaceActorReviewAuthorizer(context) {
  const actor = context?.workspaceActor;
  const decision = permissionDecision(actor, 'cbcap.plan.review');
  if (!decision.ok) throw new Error('Review authorization failed.');
  return {
    subject: decision.actor.principalId,
    tenantId: decision.actor.tenantId,
    role: decision.actor.role,
    access: decision.actor.access,
  };
}

module.exports = {
  createInstitutionalCBCAPGateway,
  workspaceActorReviewAuthorizer,
};
