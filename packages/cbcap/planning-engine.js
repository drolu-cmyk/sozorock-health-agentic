/**
 * CB-CAP Planning Engine
 *
 * County-Based Community Access Platform.
 * Distinct from the Place Intelligence front door.
 *
 * Responsibilities:
 * - County systems intelligence
 * - Scenario modeling
 * - CHA/CHIP evidence shortlists
 * - Planning attention scores
 * - Recommended hub mix at county scale
 *
 * This engine is used by the Planner Workspace and CB-CAP Environment experiences.
 * It is not the resident-facing interface.
 */

const { ChiefOfStaff } = require("../agents/chief-of-staff");

class CBCAPPlanningEngine {
  constructor() {
    this.chief = new ChiefOfStaff();
  }

  /**
   * Build a full county planning package.
   * @param {string} fipsOrQuery
   */
  async buildCountyPlan(fipsOrQuery) {
    const base = await this.chief.runPlaceIntelligence({
      locationQuery: fipsOrQuery,
      purpose: "cbcap"
    });

    if (base.status === "error") return base;

    // CB-CAP specific enrichments
    const scenarios = this._buildScenarios(base);
    const planningAttention = this._planningAttention(base);

    return {
      type: "cbcap_county_plan",
      location: base.location,
      planningAttention,
      barrierProfile: base.barriers,
      compositeBarrier: base.compositeBarrier,
      recommendedHubMix: this._hubMix(base.hubs),
      scenarios,
      chaChipSupport: {
        status: base.brief.planStatus,
        evidenceShortlist: base.evidence.sources,
        suggestedLevers: base.actions
      },
      report: base.report || null,
      evidence: base.evidence,
      meta: {
        ...base.meta,
        engine: "cbcap-planning-v1",
        distinctFrom: "place-intelligence-front-door"
      }
    };
  }

  _buildScenarios(base) {
    const pressure = base.compositeBarrier || 40;
    return [
      {
        id: "library_first",
        name: "Library-first",
        description: "Primary investment in Library Health Equity Hub with supporting Access Day",
        projectedReach: Math.round(280 + pressure * 2.2),
        barrierReduction: Math.round(12 + pressure * 0.12),
        costIndex: 1.0
      },
      {
        id: "home_plus_library",
        name: "Home + Library",
        description: "Home pathway for high-transportation barriers plus Library hub",
        projectedReach: Math.round(340 + pressure * 2.5),
        barrierReduction: Math.round(16 + pressure * 0.14),
        costIndex: 1.35
      },
      {
        id: "balanced_three_hub",
        name: "Balanced three-hub",
        description: "Proportional Library, Community, and Home activation",
        projectedReach: Math.round(400 + pressure * 2.8),
        barrierReduction: Math.round(18 + pressure * 0.16),
        costIndex: 1.55
      }
    ];
  }

  _planningAttention(base) {
    // Simple transparent formula for demonstration
    const b = base.compositeBarrier || 40;
    return Math.min(100, Math.round(b * 0.9 + 10));
  }

  _hubMix(hubs) {
    if (!hubs || !hubs.length) return {};
    const total = hubs.reduce((s, h) => s + (h.score || 1), 0);
    const mix = {};
    hubs.forEach(h => {
      mix[h.type] = Math.round(((h.score || 1) / total) * 100) / 100;
    });
    return mix;
  }
}

module.exports = { CBCAPPlanningEngine };
