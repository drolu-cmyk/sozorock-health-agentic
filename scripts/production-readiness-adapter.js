const { EvidenceGatewayClient } = require('../packages/adapters/evidence-gateway-client');
const { createProductionPool, requiredEnv } = require('../server/production-database');

function liveProof(env = process.env) {
  const raw = requiredEnv(env, 'CB_CAP_LIVE_PROOF_JSON', 65536);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('CB_CAP_LIVE_PROOF_JSON is invalid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CB_CAP_LIVE_PROOF_JSON must be an object.');
  return value;
}

function proofSection(proof, name) {
  const value = proof[name];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Live proof section ${name} is missing.`);
  return structuredClone(value);
}

exports.createReadinessOptions = async function createReadinessOptions() {
  const proof = liveProof(process.env);
  const evidenceOrigin = requiredEnv(process.env, 'EVIDENCE_GATEWAY_ORIGIN', 512);
  const pool = createProductionPool(process.env);
  return {
    pool,
    tenantA: String(process.env.CB_CAP_PREFLIGHT_TENANT_A || 'cbcap-preflight-tenant-a'),
    tenantB: String(process.env.CB_CAP_PREFLIGHT_TENANT_B || 'cbcap-preflight-tenant-b'),
    evidenceClient: new EvidenceGatewayClient({ baseUrl: evidenceOrigin }),
    identityProbe: async () => proofSection(proof, 'identity'),
    deploymentProbe: async () => proofSection(proof, 'deployment'),
    recoveryProbe: async () => proofSection(proof, 'recovery'),
    observabilityProbe: async () => proofSection(proof, 'observability'),
    rollbackProbe: async () => proofSection(proof, 'rollback'),
  };
};

module.exports.liveProof = liveProof;
module.exports.proofSection = proofSection;
