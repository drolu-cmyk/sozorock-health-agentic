const { selectVisualization } = require('../packages/cbcap/visualization-intelligence');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

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

      let spec;
      try {
        spec = selectVisualization(input || {});
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

module.exports = { createCBCAPVisualizationApi };
