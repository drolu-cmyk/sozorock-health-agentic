/**
 * Base National Data Adapter
 *
 * All adapters must:
 * - Return signals only when source-backed
 * - Attach SourceLineage to every signal
 * - Report availability honestly (available | snapshot | unavailable)
 */

const { createLineage } = require("../data/lineage");

class BaseAdapter {
  constructor(options = {}) {
    this.name = options.name || "base";
    this.version = options.version || "0.1.0";
  }

  /**
   * @returns {Promise<{ status: string, signals: object[], meta: object }>}
   * status: "available" | "snapshot" | "unavailable"
   */
  async fetchForCounty(fips) {
    throw new Error("fetchForCounty must be implemented");
  }

  signal(name, value, lineagePartial) {
    return {
      name,
      value,
      lineage: createLineage(lineagePartial)
    };
  }

  unavailable(reason) {
    return {
      status: "unavailable",
      signals: [],
      meta: {
        adapter: this.name,
        version: this.version,
        reason: reason || "No source data for this geography"
      }
    };
  }
}

module.exports = { BaseAdapter };
