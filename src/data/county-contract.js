/**
 * County Data Contract
 *
 * Defines the stable shape expected by agents and frontend consumers.
 * Adapters that pull from CDC PLACES, Census, or other public sources
 * should normalize into this contract.
 *
 * Designed to cover all 3,144 county equivalents.
 */

/**
 * @typedef {Object} CountyRecord
 * @property {string} fips - 5-digit FIPS code
 * @property {string} name - County name
 * @property {string} state - Two-letter state code
 * @property {Object} geography - { lat, lng, bbox? }
 * @property {Object} barriers - Key/value pressure scores (0-100)
 * @property {Object} chronic - Optional public chronic-condition estimates
 * @property {string[]} sources - Citation strings or source IDs
 * @property {string} freshness - ISO date of underlying data release
 */

const REQUIRED_FIELDS = [
  "fips",
  "name",
  "state",
  "geography",
  "barriers",
  "sources",
  "freshness"
];

function validate(record) {
  const missing = REQUIRED_FIELDS.filter(function (f) {
    return record[f] === undefined || record[f] === null;
  });
  return {
    valid: missing.length === 0,
    missing
  };
}

module.exports = {
  REQUIRED_FIELDS,
  validate
};
