const { CBCAPPlanningEngine } = require('../packages/cbcap/planning-engine');
const { createGovernedScenarioHandler } = require('../packages/cbcap/scenario-governance');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');
const { createCBCAPApi } = require('./cbcap-api');
const { createCBCAPFundingApi } = require('./cbcap-funding-api');
const { createCBCAPMemoryApi } = require('./cbcap-memory-api');
const { createCBCAPMonitoringApi } = require('./cbcap-monitoring-api');
const { createCBCAPReviewApi } = require('./cbcap-review-api');
const { createCBCAPVisualizationApi } = require('./cbcap-visualization-api');
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

    let scenarioHandler = null;
    if (typeof options.scenarioRegistrationsForActor === 'function') {
      const registrations = await options.scenarioRegistrationsForActor(actor);
      if (Array.isArray(registrations) && registrations.length > 0) {
        scenarioHandler = createGovernedScenarioHandler({ registrations, clock: options.clock });
      }
    } else if (typeof options.scenarioHandlerForActor === 'function') {
      // Compatibility path for an already-reviewed, server-owned handler. Production
      // composition should prefer scenarioRegistrationsForActor so formulas stay on
      // the governed built-in method allowlist.
      const supplied = await options.scenarioHandlerForActor(actor);
      scenarioHandler = typeof supplied === 'function' ? supplied : null;
    }

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

    const visualizationApi = createCBCAPVisualizationApi({ auditSink: options.auditSink });

    const monitoringApi = typeof options.monitoringDefinitionForActor === 'function'
      && typeof options.monitoringSnapshotForActor === 'function'
      ? createCBCAPMonitoringApi({
          definitionForActor: options.monitoringDefinitionForActor,
          snapshotForActor: options.monitoringSnapshotForActor,
          findingStoreForActor: options.monitoringFindingStoreForActor,
          auditSink: options.auditSink,
          clock: options.clock,
        })
      : null;

    let memoryApi = null;
    if (typeof options.workspaceMemoryForActor === 'function' && typeof options.institutionalMemoryForActor === 'function') {
      const [workspaceMemory, institutionalMemory] = await Promise.all([
        options.workspaceMemoryForActor(actor),
        options.institutionalMemoryForActor(actor),
      ]);
      const evidenceValidator = typeof options.institutionalEvidenceValidatorForActor === 'function'
        ? await options.institutionalEvidenceValidatorForActor(actor)
        : null;
      memoryApi = createCBCAPMemoryApi({
        workspaceMemory,
        institutionalMemory,
        evidenceValidator,
        auditSink: options.auditSink,
      });
    }

    const learningMemory = typeof options.learningMemoryForActor === 'function'
      ? await options.learningMemoryForActor(actor)
      : null;
    if (learningMemory && (
      typeof learningMemory.recordTrajectory !== 'function'
      || typeof learningMemory.evaluate !== 'function'
      || typeof learningMemory.proposeCandidate !== 'function'
      || typeof learningMemory.reviewCandidate !== 'function'
    )) {
      throw new Error('Tenant learning memory does not expose the governed learning-memory contract.');
    }

    return {
      tenantId: actor.tenantId,
      actor,
      engine,
      planningApi,
      reviewApi,
      fundingApi,
      visualizationApi,
      monitoringApi,
      memoryApi,
      learningMemory,
      scenarioCapabilityEnabled: typeof scenarioHandler === 'function',
      monitoringIntelligenceEnabled: Boolean(monitoringApi),
      learningEvaluationEnabled: Boolean(learningMemory),
    };
  };
}

module.exports = { createTenantCBCAPRuntimeFactory };
