/**
 * Research Agent
 *
 * Gathers public evidence via national adapters.
 * If adapters return unavailable, does not invent indicator scores.
 * Barrier indicators are only emitted when lineage-backed signals exist.
 */

const { CdcPlacesAdapter } = require("../../adapters/cdc-places-adapter");
const { AcsAdapter } = require("../../adapters/acs-adapter");

class ResearchAgent {
  constructor() {
    this.places = new CdcPlacesAdapter();
    this.acs = new AcsAdapter();
  }

  async gather(fips) {
    const places = await this.places.fetchForCounty(fips);
    const acs = await this.acs.fetchForCounty(fips);

    const sources = [];
    const lineages = [];
    const indicators = {};

    // Map ACS signals
    for (const s of acs.signals || []) {
      lineages.push(s.lineage);
      if (s.lineage && s.lineage.citation) {
        sources.push({
          id: s.lineage.sourceTable + ":" + s.lineage.sourceField,
          title: s.lineage.sourceTable,
          releaseDate: s.lineage.release,
          citation: s.lineage.citation,
          usedFor: s.name
        });
      }
      if (s.name === "no_vehicle_pct") {
        // Higher no-vehicle share -> higher transportation barrier (0-100 scale)
        indicators.transportation = Math.min(100, Math.round(s.value * 4));
      }
      if (s.name === "broadband_subscription_pct") {
        // Lower broadband -> higher technology barrier
        indicators.technology = Math.min(100, Math.round(100 - s.value));
      }
    }

    // Map PLACES signals
    for (const s of places.signals || []) {
      lineages.push(s.lineage);
      if (s.lineage && s.lineage.citation) {
        sources.push({
          id: s.lineage.sourceTable + ":" + s.lineage.sourceField,
          title: s.lineage.sourceTable,
          releaseDate: s.lineage.release,
          citation: s.lineage.citation,
          usedFor: s.name
        });
      }
      if (s.name === "healthcare_access_barrier") {
        indicators.cost = Math.min(100, Math.round(s.value * 3));
      }
    }

    const hasAny = Object.keys(indicators).length > 0;
    const dataNature =
      places.status === "available" && acs.status === "available"
        ? "live_or_full_snapshot"
        : places.status === "unavailable" && acs.status === "unavailable"
          ? "none"
          : "partial_snapshot";

    // Defaults only when we have at least some source-backed indicators;
    // never invent a full profile for unknown counties.
    if (!hasAny) {
      return {
        planStatus: "No source-backed county indicators loaded for this FIPS. Load CDC PLACES and ACS snapshots or connect live APIs.",
        context: "Geography resolved, but public indicator adapters returned unavailable for this county.",
        gaps: [
          "CDC PLACES county row missing",
          "ACS county row missing",
          "Connect packages/data/snapshots/ or live adapter endpoints"
        ],
        indicators: {},
        sources: [],
        lineages: [],
        freshness: null,
        dataNature: "none",
        adapterStatus: { places: places.status, acs: acs.status }
      };
    }

    // Fill only missing dimensions with null — scoring layer must handle sparse indicators
    const fullIndicators = {
      transportation: indicators.transportation != null ? indicators.transportation : null,
      technology: indicators.technology != null ? indicators.technology : null,
      workforce: indicators.workforce != null ? indicators.workforce : null,
      cost: indicators.cost != null ? indicators.cost : null,
      language: indicators.language != null ? indicators.language : null
    };

    const freshnessDates = sources.map(s => s.releaseDate).filter(Boolean);
    const freshness = freshnessDates.sort().slice(-1)[0] || null;

    return {
      planStatus: "Source-backed indicators available for local planning review.",
      context: "Indicators derived from public ACS and/or CDC PLACES fields with lineage on each signal.",
      gaps: Object.entries(fullIndicators)
        .filter(([, v]) => v == null)
        .map(([k]) => `No source-backed value for ${k}`),
      indicators: fullIndicators,
      sources,
      lineages,
      freshness,
      dataNature,
      adapterStatus: { places: places.status, acs: acs.status }
    };
  }
}

module.exports = { ResearchAgent };
