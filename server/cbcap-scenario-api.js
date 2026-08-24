const { COUNTY_FIPS, hasUserAssumptions } = require('../packages/runtime/contracts');
const { evaluateProportionalRange } = require('../packages/cbcap/governed-scenarios');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('request body must be an object.');
  const allowed = new Set(['countyFips', 'assumptions']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Unsupported scenario request field ${key}.`);
  const countyFips = String(input.countyFips || '').trim();
  if (!COUNTY_FIPS.test(countyFips)) throw new Error('countyFips must be a five-digit FIPS.');
  if (!hasUserAssumptions(input.assumptions)) throw new Error('assumptions must be a non-empty object whose entries are explicitly marked source=user.');
  return { countyFips, assumptions: structuredClone(input.assumptions) };
}

function createCBCAPScenarioApi(options = {}) {
  const evidenceClient = options.evidenceClient;
  if (!evidenceClient || typeof evidenceClient.getCountyPackage !== 'function') throw new Error('Scenario API requires a governed Evidence Gateway client.');
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};

  return {
    async handle(input, context = {}) {
      let actor;
      let request;
      try {
        actor = validateWorkspaceActor(context.workspaceActor);
        request = validateInput(input);
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }

      let evidence;
      try {
        evidence = await evidenceClient.getCountyPackage(request.countyFips);
      } catch {
        return { statusCode: 502, body: { error: 'Governed evidence could not complete the scenario request.' } };
      }

      let result;
      try {
        result = evaluateProportionalRange({ evidence, assumptions: request.assumptions });
      } catch (error) {
        return { statusCode: 422, body: { error: error.message, status: 'scenario_blocked' } };
      }

      auditSink({
        action: 'cbcap_scenario_evaluated',
        tenantId: actor.tenantId,
        principalId: actor.principalId,
        countyFips: request.countyFips,
        modelId: result.model.id,
        modelVersion: result.model.version,
        evidenceReleaseId: result.evidenceRelease.releaseId,
        status: result.status,
      });
      return { statusCode: 200, body: result };
    },
  };
}

module.exports = { createCBCAPScenarioApi, validateInput };
