const { CBCAPPlanningEngine } = require('../packages/cbcap/planning-engine');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');
const { createCBCAPApi } = require('./cbcap-api');
const { createCBCAPFundingApi } = require('./cbcap-funding-api');
const { createCBCAPReviewApi } = require('./cbcap-review-api');
const { workspaceActorReviewAuthorizer } = require('./institutional-cbcap-gateway');

function createTenantCBCAPRuntimeFactory(options = {}) {
  if (typeof options.memoryForActor !== 'function') {
    throw new Error('Tenant CB-CAP runtime factory requires memoryForActor(actor).');
  }

  return async function runtimeForActor(actorInput) {
    const actor = validateWorkspaceActor(actorInput);
    const memory = await options.memoryForActor(actor);
    if (!memory || typeof memory.read !== 'function' || typeof memory.createRun !== 'function') {
      throw new Error('Tenant CB-CAP runtime requires a valid tenant-scoped run-memory implementation.');
    }

    const scenarioHandler = typeof options.scenarioHandlerForActor === 'function'
      ? await options.scenarioHandlerForActor(actor)
      : null;
    const publishHandler = typeof options.publishHandlerForActor === 'function'
      ? await options.publishHandlerForActor(actor)
      : null;

    const engine = new CBCAPPlanningEngine({
      tenantId: actor.tenantId,
      memory,
      evidenceClient: options.evidenceClientForActor
        ? await options.evidenceClientForActor(actor)
        : undefined,
      evidenceOrigin: options.evidenceOrigin,
      fetchImpl: options.fetchImpl,
      auditSink: options.auditSink,
      harness: options.harness,
      killSwitch: options.killSwitch,
      clock: options.clock,
      scenarioHandler: typeof scenarioHandler === 'function' ? scenarioHandler : undefined,
      publishHandler: typeof publishHandler === 'function' ? publishHandler : undefined,
    });

    const planningApi = createCBCAPApi({ engine });
    const reviewApi = typeof publishHandler === 'function'
      ? createCBCAPReviewApi({
          engine,
          authorizer: workspaceActorReviewAuthorizer,
          clock: options.clock,
          auditSink: options.auditSink,
        })
      : null;

    const fundingApi = typeof options.fundingOpportunityForActor === 'function'
      && typeof options.fundingApplicantProfileForActor === 'function'
      ? createCBCAPFundingApi({
          opportunityForActor: options.fundingOpportunityForActor,
          applicantProfileForActor: options.fundingApplicantProfileForActor,
          auditSink: options.auditSink,
        })
      : null;

    return {
      tenantId: actor.tenantId,
      actor,
      engine,
      planningApi,
      reviewApi,
      fundingApi,
    };
  };
}

module.exports = { createTenantCBCAPRuntimeFactory };
