const EVIDENCE_CONTRACT = 'sozorock.evidence-gateway.v1';
const RELEASE_HASH = /^sha256:[0-9a-f]{64}$/;
const COUNTY_FIPS = /^\d{5}$/;

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function validateEvidenceEnvelope(value, expectedCountyFips = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Evidence envelope must be an object.');
  }
  const contract = requireString(value.contract, 'evidence.contract');
  if (contract !== EVIDENCE_CONTRACT) {
    throw new Error(`Unsupported evidence contract ${contract}.`);
  }
  const releaseId = requireString(value.releaseId, 'evidence.releaseId');
  const releaseHash = requireString(value.releaseHash, 'evidence.releaseHash');
  if (!RELEASE_HASH.test(releaseHash)) {
    throw new Error('evidence.releaseHash must be a sha256 release hash.');
  }
  const countyFips = requireString(value.countyFips, 'evidence.countyFips');
  if (!COUNTY_FIPS.test(countyFips)) {
    throw new Error('evidence.countyFips must be a five-digit county FIPS.');
  }
  if (expectedCountyFips && countyFips !== expectedCountyFips) {
    throw new Error(`Evidence county ${countyFips} does not match requested county ${expectedCountyFips}.`);
  }
  for (const field of ['sourceVersions', 'metricSemantics', 'measures', 'sourceCoverage']) {
    if (!Array.isArray(value[field])) throw new Error(`evidence.${field} must be an array.`);
  }
  if (value.sourceVersions.length === 0) throw new Error('Evidence must identify at least one source version.');
  if (value.metricSemantics.length === 0) throw new Error('Evidence must identify reviewed metric semantics.');
  if (value.measures.length === 0) throw new Error('Evidence must contain at least one published measure.');
  return {
    contract,
    releaseId,
    releaseHash,
    countyFips,
    sourceVersions: structuredClone(value.sourceVersions),
    metricSemantics: structuredClone(value.metricSemantics),
    measures: structuredClone(value.measures),
    sourceCoverage: structuredClone(value.sourceCoverage),
  };
}

function hasUserAssumptions(assumptions) {
  if (!assumptions || typeof assumptions !== 'object' || Array.isArray(assumptions)) return false;
  const entries = Object.entries(assumptions);
  if (entries.length === 0) return false;
  return entries.every(([key, entry]) => {
    if (!key.trim() || !entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (entry.source !== 'user') return false;
    return Object.prototype.hasOwnProperty.call(entry, 'value');
  });
}

function isApprovedHumanRecord(approval) {
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) return false;
  if (approval.status !== 'approved' || approval.decision !== 'approve') return false;
  if (typeof approval.by !== 'string' || !approval.by.trim()) return false;
  if (approval.scope !== 'county_plan') return false;
  if (typeof approval.reviewedAt !== 'string' || !Number.isFinite(Date.parse(approval.reviewedAt))) return false;
  if (typeof approval.objectId !== 'string' || !approval.objectId.trim()) return false;
  if (typeof approval.evidenceReleaseId !== 'string' || !approval.evidenceReleaseId.trim()) return false;
  return true;
}

function approvalMatchesState(approval, state) {
  return isApprovedHumanRecord(approval)
    && approval.objectId === state?.runId
    && approval.evidenceReleaseId === state?.evidence?.releaseId;
}

module.exports = {
  COUNTY_FIPS,
  EVIDENCE_CONTRACT,
  RELEASE_HASH,
  approvalMatchesState,
  hasUserAssumptions,
  isApprovedHumanRecord,
  validateEvidenceEnvelope,
};
