const { EvidenceGatewayClient } = require('../packages/adapters/evidence-gateway-client');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

const COUNTY_ID = /^county:(\d{5})$/;

function reviewed(value) {
  return value?.review_status === 'verified' || value?.reviewStatus === 'verified';
}

function entityIdsFromPackage(evidence) {
  const package_ = evidence?.package || {};
  const ids = new Set();
  if (typeof evidence?.releaseId === 'string' && evidence.releaseId) ids.add(evidence.releaseId);
  for (const collection of [
    package_.source_versions,
    package_.metric_semantics,
    package_.measures,
    package_.planning_documents,
    package_.planning_claims,
    package_.planning_citations,
  ]) {
    for (const item of Array.isArray(collection) ? collection : []) {
      if (reviewed(item) && typeof item.id === 'string' && item.id) ids.add(item.id);
    }
  }
  return ids;
}

function createProductionGovernedEvidenceProviders(options = {}) {
  const evidenceClient = options.evidenceClient || new EvidenceGatewayClient({
    baseUrl: options.evidenceOrigin,
    fetchImpl: options.fetchImpl,
  });

  return {
    evidenceClientForActor: async (actorInput) => {
      validateWorkspaceActor(actorInput);
      return evidenceClient;
    },
    institutionalEvidenceValidatorForActor: async (actorInput) => {
      const scopedActor = validateWorkspaceActor(actorInput);
      return async (validatorActorInput, evidenceEntityIds, context = {}) => {
        const validatorActor = validateWorkspaceActor(validatorActorInput);
        if (validatorActor.tenantId !== scopedActor.tenantId) throw new Error('Institutional evidence validator tenant mismatch.');
        const match = COUNTY_ID.exec(String(context.geographyId || '').trim());
        if (!match) return { ok: false, missingIds: [...new Set(evidenceEntityIds || [])].sort() };
        if (!Array.isArray(evidenceEntityIds) || evidenceEntityIds.length < 1 || evidenceEntityIds.length > 500) {
          return { ok: false, missingIds: [] };
        }
        const evidence = await evidenceClient.getCountyPackage(match[1]);
        const admitted = entityIdsFromPackage(evidence);
        const missingIds = [...new Set(evidenceEntityIds)].filter((id) => !admitted.has(id)).sort();
        return { ok: missingIds.length === 0, missingIds };
      };
    },
  };
}

module.exports = {
  createProductionGovernedEvidenceProviders,
  entityIdsFromPackage,
};
