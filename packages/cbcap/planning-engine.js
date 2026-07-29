/**
 * CB-CAP Planning Engine
 *
 * County-Based Community Access Platform.
 * Distinct from the Place Intelligence front door.
 *
 * Scenario outputs are MODELED ESTIMATES, not measured impact.
 * Every scenario carries formula, assumptions, and uncertainty notes.
 */

const { ChiefOfStaff } = require("../agents/chief-of-staff");

// Approximate intensity points for demonstration counties only.
// Production: derive from tract-level public indicators or local configuration.
const DEMO_HEAT = {
  "36095": [ // Schoharie
    { lat: 42.68, lng: -74.49, intensity: 0.85 },
    { lat: 42.71, lng: -74.42, intensity: 0.60 },
    { lat: 42.64, lng: -74.55, intensity: 0.70 },
    { lat: 42.75, lng: -74.38, intensity: 0.45 }
  ],
  "36025": [ // Delaware
    { lat: 42.20, lng: -75.00, intensity: 0.75 },
    { lat: 42.25, lng: -74.95, intensity: 0.55 },
    { lat: 42.15, lng: -75.08, intensity: 0.65 }
  ]
};

class CBCAPPlanningEngine {
  constructor(options = {}) {
    this.chief = new ChiefOfStaff({
      auditSink: options.auditSink || (() => {})
    });
  }

  async buildCountyPlan(fipsOrQuery) {
    const base = await this.chief.runPlaceIntelligence({
      locationQuery: fipsOrQuery,
      purpose: "cbcap"
    });

    if (base.status === "error") return base;

    const scenarios = this._buildScenarios(base);
    const planningAttention = this._planningAttention(base);
    const fips = base.location && base.location.fips;

    return {
      type: "cbcap_county_plan",
      location: base.location,
      planningAttention,
      barrierProfile: base.barriers,
      compositeBarrier: base.compositeBarrier,
      recommendedHubMix: this._hubMix(base.hubs),
      scenarios,
      heatPoints: (fips && DEMO_HEAT[fips]) ? DEMO_HEAT[fips] : [],
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
        distinctFrom: "place-intelligence-front-door",
        scenariosAreModeledEstimates: true
      }
    };
  }

  _buildScenarios(base) {
    const pressure = base.compositeBarrier || 40;

    const assumptions = {
      populationDenominator: "County adult population estimate (placeholder; replace with ACS)",
      uptakeRate: "Assumed 8–15% of reachable residents engage in first 12 months",
      effectSize: "Barrier reduction is a directional model, not an evaluated outcome",
      costIndexBasis: "Relative to a baseline Library-first activation"
    };

    return [
      {
        id: "library_first",
        name: "Library-first",
        description: "Primary investment in Library Health Equity Hub with supporting Access Day",
        projectedReach: {
          value: Math.round(280 + pressure * 2.2),
          nature: "modeled_estimate",
          formula: "280 + (compositeBarrier × 2.2)",
          uncertainty: "±25% pending local population and uptake data"
        },
        barrierReduction: {
          value: Math.round(12 + pressure * 0.12),
          nature: "modeled_estimate",
          formula: "12 + (compositeBarrier × 0.12)",
          uncertainty: "Directional only; not an evaluated impact"
        },
        costIndex: 1.0,
        assumptions
      },
      {
        id: "home_plus_library",
        name: "Home + Library",
        description: "Home pathway for high-transportation barriers plus Library hub",
        projectedReach: {
          value: Math.round(340 + pressure * 2.5),
          nature: "modeled_estimate",
          formula: "340 + (compositeBarrier × 2.5)",
          uncertainty: "±30% pending coverage and uptake assumptions"
        },
        barrierReduction: {
          value: Math.round(16 + pressure * 0.14),
          nature: "modeled_estimate",
          formula: "16 + (compositeBarrier × 0.14)",
          uncertainty: "Directional only"
        },
        costIndex: 1.35,
        assumptions
      },
      {
        id: "balanced_three_hub",
        name: "Balanced three-hub",
        description: "Proportional Library, Community, and Home activation",
        projectedReach: {
          value: Math.round(400 + pressure * 2.8),
          nature: "modeled_estimate",
          formula: "400 + (compositeBarrier × 2.8)",
          uncertainty: "±30% pending multi-hub coordination capacity"
        },
        barrierReduction: {
          value: Math.round(18 + pressure * 0.16),
          nature: "modeled_estimate",
          formula: "18 + (compositeBarrier × 0.16)",
          uncertainty: "Directional only"
        },
        costIndex: 1.55,
        assumptions
      }
    ];
  }

  _planningAttention(base) {
    const b = base.compositeBarrier || 40;
    return {
      value: Math.min(100, Math.round(b * 0.9 + 10)),
      nature: "modeled_score",
      formula: "min(100, compositeBarrier × 0.9 + 10)"
    };
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
