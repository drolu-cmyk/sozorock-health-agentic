const {
  buildVisualizationWorkspace,
  MAX_COUNTIES,
  SUPPORTED_QUESTIONS,
} = require('../packages/cbcap/visualization-workspace');
const { renderVisualizationWorkspace } = require('../packages/cbcap/workspace-renderers');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

const ALLOWED_FIELDS = new Set([
  'question',
  'countyFips',
  'sourceMeasureIds',
  'selectedCountyFips',
]);

function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('request body must be an object.');
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`Unsupported visualization workspace field ${key}.`);
  }
  const question = String(input.question || '').trim();
  if (!SUPPORTED_QUESTIONS.includes(question)) throw new Error(`Unsupported visualization workspace question ${question || 'missing'}.`);
  if (!Array.isArray(input.countyFips) || input.countyFips.length === 0) throw new Error('countyFips must be a non-empty array.');
  if (input.countyFips.length > MAX_COUNTIES) throw new Error('countyFips exceeds the workspace limit.');
  const countyFips = input.countyFips.map((value) => String(value || '').trim());
  if (countyFips.some((value) => !/^\d{5}$/.test(value))) throw new Error('countyFips must contain five-digit county FIPS values.');
  if (new Set(countyFips).size !== countyFips.length) throw new Error('countyFips must not contain duplicates.');
  if (!Array.isArray(input.sourceMeasureIds) || input.sourceMeasureIds.length === 0 || input.sourceMeasureIds.length > 8) {
    throw new Error('sourceMeasureIds must contain between one and eight source measure IDs.');
  }
  const sourceMeasureIds = input.sourceMeasureIds.map((value) => String(value || '').trim());
  if (sourceMeasureIds.some((value) => !value || value.length > 240)) throw new Error('sourceMeasureIds contains an invalid value.');
  if (new Set(sourceMeasureIds).size !== sourceMeasureIds.length) throw new Error('sourceMeasureIds must not contain duplicates.');
  const selectedCountyFips = input.selectedCountyFips === undefined || input.selectedCountyFips === null
    ? null
    : String(input.selectedCountyFips).trim();
  if (selectedCountyFips && !countyFips.includes(selectedCountyFips)) {
    throw new Error('selectedCountyFips must be one of countyFips.');
  }
  return {
    question,
    countyFips,
    sourceMeasureIds,
    selectedCountyFips,
  };
}

function createCBCAPVisualizationWorkspaceApi(options = {}) {
  const evidenceClient = options.evidenceClient;
  if (!evidenceClient || typeof evidenceClient.getCountyPackage !== 'function') {
    throw new Error('Visualization workspace API requires an Evidence Gateway client.');
  }
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};

  return {
    async handle(input, context = {}) {
      let actor;
      try {
        actor = validateWorkspaceActor(context.workspaceActor);
      } catch {
        return { statusCode: 403, body: { error: 'Visualization workspace authorization failed.' } };
      }

      let request;
      try {
        request = validateRequest(input || {});
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }

      let evidencePackages;
      try {
        evidencePackages = await Promise.all(
          request.countyFips.map((countyFips) => evidenceClient.getCountyPackage(countyFips)),
        );
      } catch {
        return { statusCode: 503, body: { error: 'Reviewed Evidence Gateway packages are unavailable for the requested workspace.' } };
      }

      try {
        const workspace = buildVisualizationWorkspace({
          question: request.question,
          sourceMeasureIds: request.sourceMeasureIds,
          selectedCountyFips: request.selectedCountyFips,
          evidencePackages,
        });
        workspace.renderPackage = renderVisualizationWorkspace(workspace);
        auditSink({
          action: 'cbcap_visualization_workspace_created',
          tenantId: actor.tenantId,
          principalId: actor.principalId,
          question: workspace.question,
          countyCount: workspace.countyFips.length,
          sourceMeasureIds: workspace.sourceMeasureIds,
          artifactFamily: workspace.plan.artifactFamily,
          renderer: workspace.renderPackage.renderer,
          claimId: workspace.claimId,
        });
        return { statusCode: 200, body: workspace };
      } catch (error) {
        auditSink({
          action: 'cbcap_visualization_workspace_blocked',
          tenantId: actor.tenantId,
          principalId: actor.principalId,
          question: request.question,
          countyCount: request.countyFips.length,
          sourceMeasureIds: request.sourceMeasureIds,
          reason: error.message,
        });
        return { statusCode: 422, body: { error: error.message } };
      }
    },
  };
}

module.exports = {
  ALLOWED_FIELDS,
  createCBCAPVisualizationWorkspaceApi,
  validateRequest,
};
