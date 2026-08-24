const { createGovernedScenarioHandler } = require('../packages/cbcap/governed-scenarios');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

function createGovernedScenarioHandlerForActor(options = {}) {
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};
  return async function scenarioHandlerForActor(actorInput) {
    const actor = validateWorkspaceActor(actorInput);
    if (actor.actorType !== 'human') return null;
    const handler = createGovernedScenarioHandler();
    return async function auditedScenarioHandler(...args) {
      const result = await handler(...args);
      auditSink({
        action: 'cbcap_governed_scenario_completed',
        tenantId: actor.tenantId,
        principalId: actor.principalId,
        modelId: result.model.id,
        modelVersion: result.model.version,
        evidenceReleaseId: result.evidenceRelease.releaseId,
        geographyId: result.geography.id,
        status: result.status,
      });
      return result;
    };
  };
}

module.exports = { createGovernedScenarioHandlerForActor };
