/**
 * ZIP → FIPS / County Resolution
 *
 * Deterministic geography resolution.
 * Production: load full HUD / Census crosswalk.
 * Current: high-fidelity sample + clear extension point for full 41k+ ZIPs.
 *
 * Required for every place intelligence request.
 */

const ZIP_TO_FIPS = {
  // Schoharie County, NY (primary demo)
  "12043": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12043" },
  "12031": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12031" },
  "12036": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12036" },
  "12071": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12071" },
  "12076": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12076" },
  "12092": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12092" },
  "12093": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12093" },
  "12122": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12122" },
  "12157": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12157" },
  "12160": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12160" },
  "12175": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12175" },
  "12187": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12187" },
  "12194": { fips: "36095", county: "Schoharie", state: "NY", zcta: "12194" },
  "13459": { fips: "36095", county: "Schoharie", state: "NY", zcta: "13459" },

  // Delaware County, NY (secondary)
  "13753": { fips: "36025", county: "Delaware", state: "NY", zcta: "13753" },
  "13739": { fips: "36025", county: "Delaware", state: "NY", zcta: "13739" },
  "13740": { fips: "36025", county: "Delaware", state: "NY", zcta: "13740" },
  "13750": { fips: "36025", county: "Delaware", state: "NY", zcta: "13750" },
  "13752": { fips: "36025", county: "Delaware", state: "NY", zcta: "13752" },
  "13754": { fips: "36025", county: "Delaware", state: "NY", zcta: "13754" },
  "13755": { fips: "36025", county: "Delaware", state: "NY", zcta: "13755" },
  "13756": { fips: "36025", county: "Delaware", state: "NY", zcta: "13756" },
  "13757": { fips: "36025", county: "Delaware", state: "NY", zcta: "13757" },
  "13775": { fips: "36025", county: "Delaware", state: "NY", zcta: "13775" },
  "13782": { fips: "36025", county: "Delaware", state: "NY", zcta: "13782" },
  "13786": { fips: "36025", county: "Delaware", state: "NY", zcta: "13786" },
  "13788": { fips: "36025", county: "Delaware", state: "NY", zcta: "13788" },
  "13806": { fips: "36025", county: "Delaware", state: "NY", zcta: "13806" },
  "13842": { fips: "36025", county: "Delaware", state: "NY", zcta: "13842" },
  "13856": { fips: "36025", county: "Delaware", state: "NY", zcta: "13856" }
};

/**
 * Resolve a ZIP, city+state string, or FIPS to a canonical geography record.
 * @param {string} query
 * @returns {{ fips: string, county: string, state: string, zcta?: string } | null}
 */
function resolveGeography(query) {
  if (!query) return null;
  const cleaned = String(query).trim().toUpperCase();

  // Direct ZIP
  if (/^\d{5}$/.test(cleaned) && ZIP_TO_FIPS[cleaned]) {
    return { ...ZIP_TO_FIPS[cleaned] };
  }

  // Direct FIPS
  if (/^\d{5}$/.test(cleaned)) {
    const match = Object.values(ZIP_TO_FIPS).find(r => r.fips === cleaned);
    if (match) return { fips: match.fips, county: match.county, state: match.state };
  }

  // Simple name match (demo)
  const lower = cleaned.toLowerCase();
  if (lower.includes("schoharie") || lower.includes("cobleskill")) {
    return { fips: "36095", county: "Schoharie", state: "NY" };
  }
  if (lower.includes("delaware") && lower.includes("ny")) {
    return { fips: "36025", county: "Delaware", state: "NY" };
  }

  return null;
}

module.exports = {
  resolveGeography,
  ZIP_TO_FIPS,
  // Extension point: loadFullCrosswalk() for production HUD/Census file
};
