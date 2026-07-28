/**
 * Research Agent
 * Gathers public evidence for a county with mandatory source freshness and citations.
 * In production this pulls from versioned public releases (CDC PLACES, Census, etc.).
 */

class ResearchAgent {
  async gather(fips) {
    // Structured public-evidence package.
    // Production: replace with live adapters that carry release dates.
    const catalog = {
      "36095": {
        planStatus: "Local CHA/CHIP cycle active. Library Health Equity Hub format under review.",
        context: "Rural county with elevated transportation and digital-readiness barriers relative to state median. Public estimates indicate provider shortage pressure.",
        gaps: [
          "Transportation barrier percentile above state median",
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
        sources: [
          {
            id: "cdc-places-2025",
            title: "CDC PLACES County Data",
            releaseDate: "2025-12-04",
            citation: "Centers for Disease Control and Prevention. PLACES: Local Data for Better Health, 2025 release."
          },
          {
            id: "census-tiger-2025",
            title: "U.S. Census TIGER/Line",
            releaseDate: "2025-01-01",
            citation: "U.S. Census Bureau. TIGER/Line Shapefiles, 2025."
          }
        ],
        freshness: "2025-12-04"
      },
      "36025": {
        planStatus: "Public data available. Local plan status requires county-level review.",
        context: "Delaware County shows mixed barrier profile with notable transportation and workforce signals.",
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
        sources: [
          {
            id: "cdc-places-2025",
            title: "CDC PLACES County Data",
            releaseDate: "2025-12-04",
            citation: "Centers for Disease Control and Prevention. PLACES: Local Data for Better Health, 2025 release."
          }
        ],
        freshness: "2025-12-04"
      }
    };

    const record = catalog[fips] || {
      planStatus: "Public data available. Local plan status requires county-level review.",
      context: "Place-level estimates drawn from public sources. Barriers vary by geography.",
      gaps: ["Further local review recommended"],
      indicators: {
        transportation: 40,
        technology: 35,
        workforce: 45,
        cost: 50,
        language: 25
      },
      sources: [
        {
          id: "cdc-places-2025",
          title: "CDC PLACES County Data",
          releaseDate: "2025-12-04",
          citation: "Centers for Disease Control and Prevention. PLACES: Local Data for Better Health, 2025 release."
        }
      ],
      freshness: "2025-12-04"
    };

    return record;
  }
}

module.exports = { ResearchAgent };
