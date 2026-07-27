/**
 * Agent Orchestrator
 *
 * Coordinates PlaceAgent and HubMatcher, applies policy checks, and produces
 * a single machine-readable package that frontend or external agents can consume.
 *
 * This is the core of the agentic infrastructure.
 */

const { PlaceAgent } = require("./place-agent");
const { HubMatcher } = require("./hub-matcher");

class Orchestrator {
  constructor(options = {}) {
    this.placeAgent = new PlaceAgent({
      resolvePlace: options.resolvePlace
    });
    this.hubMatcher = new HubMatcher();
  }

  /**
   * Full pipeline: location → place analysis → hub ranking → policy gate
   * @param {string} locationQuery
   * @returns {Promise<object>}
   */
  async run(locationQuery) {
    const analysis = await this.placeAgent.analyze(locationQuery);

    if (analysis.status !== "ok") {
      return analysis;
    }

    // Enrich with hub ranking
    analysis.hubRanking = this.hubMatcher.match(analysis.barriers || {});

    // Policy enforcement (non-clinical + source-traceable)
    const policy = this._checkPolicy(analysis);
    analysis.policy = policy;

    if (!policy.ok) {
      return {
        status: "blocked",
        reason: "Policy violation",
        violations: policy.violations,
        locationQuery
      };
    }

    analysis.meta = analysis.meta || {};
    analysis.meta.orchestratedAt = new Date().toISOString();
    analysis.meta.agentVersion = "0.2.0";

    return analysis;
  }

  _checkPolicy(result) {
    const violations = [];
    if (result.clinicalAdvice || result.diagnosis || result.treatment) {
      violations.push("Clinical content is not permitted");
    }
    if (!result.meta || result.meta.nonClinical !== true) {
      violations.push("Missing nonClinical declaration");
    }
    if (!result.meta || result.meta.sourceTraceable !== true) {
      violations.push("Missing sourceTraceable declaration");
    }
    return { ok: violations.length === 0, violations };
  }
}

module.exports = { Orchestrator };
