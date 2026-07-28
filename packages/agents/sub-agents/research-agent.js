/**
 * Research Agent
 *
 * Current state: returns structured public-evidence packages for demonstration counties.
 * Scores are MODELED ESTIMATES derived from public-style indicators, not direct
 * extractions from a live CDC/Census query. Every package carries methodology notes
 * and source citations with release dates.
 *
 * Extension point: replace gather() body with live adapters that:
 *   1. Fetch CDC PLACES / Census / local releases
 *   2. Map specific fields to barrier indicators
 *   3. Record retrieval timestamp and exact source field
 */

class ResearchAgent {
  async gather(fips) {
    const catalog = {
      "36095": {
        planStatus: "Local CHA/CHIP cycle active. Library Health Equity Hub format under review.",
        context: "Rural county demonstration profile. Transportation and digital-readiness pressures are elevated relative to typical state medians in public estimates.",
        gaps: [
          "Transportation barrier pressure elevated in modeled profile",
          "Digital readiness gap flagged for local review",
          "Workforce capacity signal for community health roles"
        ],
        indicators: {
          transportation: 72,
          technology: 58,
          workforce: 65,
          cost: 45,
          language: 18
        },
        indicatorNotes: {
          method: "Modeled demonstration values. Not direct field extractions from a live dataset query.",
          intendedReplacement: "Map specific CDC PLACES / ACS fields to each indicator with field-level citation."
        },
        sources: [
          {
            id: "cdc-places-2025",
            title: "CDC PLACES County Data",
            releaseDate: "2025-12-04",
            citation: "Centers for Disease Control and Prevention. PLACES: Local Data for Better Health, 2025 release.",
            usedFor: "Contextual reference for county-level chronic and access estimates"
          },
          {
            id: "census-tiger-2025",
            title: "U.S. Census TIGER/Line",
            releaseDate: "2025-01-01",
            citation: "U.S. Census Bureau. TIGER/Line Shapefiles, 2025.",
            usedFor: "Geography boundaries"
          }
        ],
        freshness: "2025-12-04",
        dataNature: "modeled_demonstration"
      },
      "36025": {
        planStatus: "Public data available. Local plan status requires county-level review.",
        context: "Delaware County demonstration profile with mixed barrier signals.",
        gaps: [
          "Further local review recommended for pathway breaks",
          "Source freshness check advised for local program data"
        ],
        indicators: {
          transportation: 68,
          technology: 52,
          workforce: 60,
          cost: 48,
          language: 22
        },
        indicatorNotes: {
          method: "Modeled demonstration values. Not direct field extractions from a live dataset query.",
          intendedReplacement: "Map specific CDC PLACES / ACS fields to each indicator with field-level citation."
        },
        sources: [
          {
            id: "cdc-places-2025",
            title: "CDC PLACES County Data",
            releaseDate: "2025-12-04",
            citation: "Centers for Disease Control and Prevention. PLACES: Local Data for Better Health, 2025 release.",
            usedFor: "Contextual reference"
          }
        ],
        freshness: "2025-12-04",
        dataNature: "modeled_demonstration"
      }
    };

    const record = catalog[fips] || {
      planStatus: "Public data available. Local plan status requires county-level review.",
      context: "Generic demonstration profile. Barrier scores are modeled estimates.",
      gaps: ["Further local review recommended", "Connect live public data adapters for production use"],
      indicators: {
        transportation: 40,
        technology: 35,
        workforce: 45,
        cost: 50,
        language: 25
      },
      indicatorNotes: {
        method: "Modeled demonstration values for unsupported geography.",
        intendedReplacement: "Live adapter required."
      },
      sources: [
        {
          id: "cdc-places-2025",
          title: "CDC PLACES County Data",
          releaseDate: "2025-12-04",
          citation: "Centers for Disease Control and Prevention. PLACES: Local Data for Better Health, 2025 release.",
          usedFor: "Contextual reference"
        }
      ],
      freshness: "2025-12-04",
      dataNature: "modeled_demonstration"
    };

    return record;
  }
}

module.exports = { ResearchAgent };
