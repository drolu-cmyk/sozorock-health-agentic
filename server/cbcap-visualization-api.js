const { buildAnalyticalWorkspace } = require('../packages/cbcap/analytical-workspace');
const { selectVisualization } = require('../packages/cbcap/visualization-intelligence');
const { renderWorkspacePackage } = require('../packages/cbcap/workspace-renderers');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

const ALLOWED_FIELDS = new Set([
  'question',
  'measure',
  'itemCount',
  'seriesCount',
  'timePointCount',
  'geographyKind',
  'spatiallyMeaningful',
  'hasBoundaryGeometry',
  'hasConfidenceIntervals',
  'hasMissingValues',
  'comparableVintages',
  'distributionAvailable',
  'relationshipEdgesAvailable',
  'normalizationStatus',
]);

const ALLOWED_MEASURE_FIELDS = new Set([
  'id',
  'name',
  'unit',
  'direction',
  'comparisonPolicy',
]);

function validateRequestShape(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('request body must be an object.');
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`Unsupported visualization request field ${key}.`);
  }
  if (input.measure !== undefined && input.measure !== null) {
    if (typeof input.measure !== 'object' || Array.isArray(input.measure)) throw new Error('measure must be an object.');
    for (const key of Object.keys(input.measure)) {
      if (!ALLOWED_MEASURE_FIELDS.has(key)) throw new Error(`Unsupported measure field ${key}.`);
    }
  }
  return input;
}

function isWorkspaceRequest(input) {
  return Boolean(
    input
    && typeof input === 'object'
    && !Array.isArray(input)
    && typeof input.requestId === 'string'
    && Array.isArray(input.measures)
    && Array.isArray(input.geographies)
    && Array.isArray(input.observations),
  );
}

function createCBCAPVisualizationApi(options = {}) {
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};

  return {
    async handle(input, context = {}) {
      let actor;
      try {
        actor = validateWorkspaceActor(context.workspaceActor);
      } catch {
        return { statusCode: 403, body: { error: 'Visualization planning authorization failed.' } };
      }

      if (isWorkspaceRequest(input)) {
        let workspace;
        try {
          workspace = buildAnalyticalWorkspace(input);
          workspace.renderPackage = renderWorkspacePackage(workspace);
        } catch (error) {
          return { statusCode: 400, body: { error: error.message } };
        }
        auditSink({
          action: 'cbcap_analytical_workspace_created',
          tenantId: actor.tenantId,
          principalId: actor.principalId,
          requestId: workspace.request.requestId,
          question: workspace.request.question,
          artifactFamily: workspace.plan.artifactFamily,
          renderer: workspace.renderPackage.renderer,
          scope: workspace.request.scope,
          dataFingerprint: workspace.plan.dataFingerprint,
        });
        return { statusCode: workspace.plan.status === 'blocked' ? 422 : 200, body: workspace };
      }

      let spec;
      try {
        spec = selectVisualization(validateRequestShape(input || {}));
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }

      auditSink({
        action: 'cbcap_visualization_spec_created',
        tenantId: actor.tenantId,
        principalId: actor.principalId,
        question: spec.question,
        artifactFamily: spec.artifactFamily,
        visualizationStatus: spec.status,
      });

      return { statusCode: spec.status === 'blocked' ? 422 : 200, body: spec };
    },
  };
}

module.exports = {
  ALLOWED_FIELDS,
  createCBCAPVisualizationApi,
  isWorkspaceRequest,
  validateRequestShape,
};
