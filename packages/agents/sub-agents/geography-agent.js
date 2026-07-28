/**
 * Geography Agent
 * Resolves any location query to a canonical FIPS + county record.
 */

const { resolveGeography } = require("../../data/zip-to-fips");

class GeographyAgent {
  async resolve(query) {
    return resolveGeography(query);
  }
}

module.exports = { GeographyAgent };
