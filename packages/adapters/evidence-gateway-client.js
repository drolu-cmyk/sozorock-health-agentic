const { createHash } = require('crypto');
const {
  COUNTY_FIPS,
  EVIDENCE_CONTRACT,
  validateEvidenceEnvelope,
} = require('../runtime/contracts');

const PLANNING_CONTRACT = 'sozorock.evidence-gateway.planning.v1';

function packageHash(packageData) {
  return `sha256:${createHash('sha256').update(JSON.stringify(packageData)).digest('hex')}`;
}

function validatePlanningExtension(packageData) {
  const fields = ['planning_contract_version', 'planning_documents', 'planning_claims', 'planning_citations'];
  const present = fields.filter((field) => Object.prototype.hasOwnProperty.call(packageData || {}, field));
  if (present.length === 0) return;
  if (present.length !== fields.length) throw new Error('Evidence Gateway planning extension is incomplete.');
  if (packageData.planning_contract_version !== PLANNING_CONTRACT) {
    throw new Error(`Unsupported Evidence Gateway planning contract ${packageData.planning_contract_version || 'missing'}.`);
  }
  for (const field of ['planning_documents', 'planning_claims', 'planning_citations']) {
    if (!Array.isArray(packageData[field])) throw new Error(`Evidence Gateway ${field} must be an array.`);
  }
}

class EvidenceGatewayClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || global.fetch;
    if (!this.baseUrl.startsWith('https://')) throw new Error('Evidence Gateway baseUrl must use https.');
    if (typeof this.fetchImpl !== 'function') throw new Error('Evidence Gateway requires fetch support.');
  }

  async getCountyPackage(countyFips) {
    if (!COUNTY_FIPS.test(String(countyFips))) throw new Error('countyFips must be a five-digit FIPS.');
    const response = await this.fetchImpl(`${this.baseUrl}/api/evidence/v1/gateway?geoid=${encodeURIComponent(countyFips)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Evidence Gateway returned HTTP ${response.status}.`);

    const contract = response.headers.get('x-evidence-contract');
    const releaseId = response.headers.get('x-evidence-release');
    const releaseHash = response.headers.get('x-evidence-release-hash');
    if (contract !== EVIDENCE_CONTRACT) throw new Error(`Unexpected Evidence Gateway contract ${contract || 'missing'}.`);

    const body = await response.json();
    const geographies = body?.package?.geographies;
    if (!Array.isArray(geographies) || geographies.length !== 1) {
      throw new Error('Evidence Gateway county package must contain exactly one geography.');
    }
    const geography = geographies[0];
    if (geography?.kind !== 'county') {
      throw new Error('Evidence Gateway county package must contain a county geography.');
    }

    validatePlanningExtension(body?.package);
    const calculatedHash = packageHash(body?.package);
    if (body?.manifest?.release_hash !== calculatedHash) {
      throw new Error('Evidence Gateway package SHA256 does not match its manifest release hash.');
    }

    const envelope = validateEvidenceEnvelope({
      contract: body?.manifest?.contract_version,
      releaseId: body?.manifest?.release_id,
      releaseHash: body?.manifest?.release_hash,
      countyFips: geography?.county_fips,
      sourceVersions: body?.package?.source_versions,
      metricSemantics: body?.package?.metric_semantics,
      measures: body?.package?.measures,
      sourceCoverage: body?.package?.source_coverage,
    }, String(countyFips));

    if (releaseId !== envelope.releaseId) throw new Error('Evidence Gateway release header does not match the package manifest.');
    if (releaseHash !== envelope.releaseHash) throw new Error('Evidence Gateway release hash header does not match the package manifest.');
    if (body?.package?.contract_version !== envelope.contract) throw new Error('Evidence Gateway package contract does not match its manifest.');
    if (body?.package?.release_id !== envelope.releaseId) throw new Error('Evidence Gateway package release does not match its manifest.');

    return {
      ...envelope,
      package: structuredClone(body.package),
    };
  }
}

module.exports = {
  EvidenceGatewayClient,
  PLANNING_CONTRACT,
  packageHash,
  validatePlanningExtension,
};
