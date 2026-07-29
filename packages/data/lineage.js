/**
 * Source Lineage Contract
 *
 * Every derived planning signal must carry this metadata.
 * Without it, the signal is not admissible for display or export.
 */

/**
 * @typedef {Object} SourceLineage
 * @property {string} sourceTable   - e.g. "CDC_PLACES_COUNTY", "ACS_5YR_B08201"
 * @property {string} sourceField   - e.g. "ACCESS2_CrudePrev", "B08201_002E"
 * @property {string} release       - e.g. "2025-12-04" or "ACS 2019-2023"
 * @property {string} geography     - FIPS or GEOID used in the source row
 * @property {string} transformation - e.g. "direct", "normalized_0_100", "inverse_percentile"
 * @property {string} retrievedAt   - ISO timestamp of retrieval
 * @property {string} [citation]    - Human-readable citation
 */

function createLineage(partial) {
  const required = ["sourceTable", "sourceField", "release", "geography", "transformation", "retrievedAt"];
  for (const key of required) {
    if (!partial || !partial[key]) {
      throw new Error(`SourceLineage missing required field: ${key}`);
    }
  }
  return {
    sourceTable: String(partial.sourceTable),
    sourceField: String(partial.sourceField),
    release: String(partial.release),
    geography: String(partial.geography),
    transformation: String(partial.transformation),
    retrievedAt: String(partial.retrievedAt),
    citation: partial.citation || null
  };
}

function isValidLineage(obj) {
  try {
    createLineage(obj);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  createLineage,
  isValidLineage
};
