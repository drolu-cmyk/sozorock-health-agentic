/**
 * Report Agent
 * Produces purpose-specific structured briefs for planners and funders.
 * Never includes clinical content.
 */

class ReportAgent {
  generate(package_, purpose) {
    if (purpose === "funder") {
      return {
        type: "funder_evidence",
        title: "Place Evidence Brief — " + package_.location.county + " County",
        reachPotential: this._estimateReach(package_),
        hubMix: package_.hubs.map(h => ({ type: h.type, fit: h.fit })),
        barrierPressure: package_.compositeBarrier,
        recommendedFocus: package_.hubs[0] ? package_.hubs[0].type + " Health Equity Hub" : "Further assessment",
        evidenceFreshness: package_.evidence.freshness,
        citations: package_.evidence.sources.map(s => s.citation)
      };
    }

    if (purpose === "planner" || purpose === "cbcap") {
      return {
        type: "planner_brief",
        title: "Planning Brief — " + package_.location.county + " County",
        planStatus: package_.brief.planStatus,
        priorityBarriers: Object.entries(package_.barriers)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => ({ barrier: k, score: v })),
        recommendedHubs: package_.hubs,
        suggestedNextSteps: package_.actions,
        evidenceFreshness: package_.evidence.freshness,
        citations: package_.evidence.sources.map(s => s.citation)
      };
    }

    return null;
  }

  _estimateReach(package_) {
    // Simple deterministic estimate for demonstration
    const base = 300;
    const pressure = package_.compositeBarrier || 40;
    return Math.round(base * (pressure / 50));
  }
}

module.exports = { ReportAgent };
