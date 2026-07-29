/**
 * ZIP ↔ County Crosswalk
 *
 * Handles:
 * - Primary county for a ZIP
 * - Multi-county ZIPs (returns all counties + primary by residential ratio when available)
 * - Load from HUD USPS ZIP-County Crosswalk file when present
 *
 * Production: place HUD crosswalk export at data/hud-zip-county.json
 * Format expected:
 * {
 *   "version": "HUD-YYYY-QN",
 *   "effectiveDate": "YYYY-MM-DD",
 *   "zips": {
 *     "12043": [{ "fips": "36095", "resRatio": 1.0 }]
 *   }
 * }
 */

const fs = require("fs");
const path = require("path");
const { getByFips } = require("./national-counties");

/** Seed crosswalk: demonstration + multi-state sample ZIPs */
const SEED_ZIPS = {
  // Schoharie, NY
  "12043": [{ fips: "36095", resRatio: 1.0 }],
  "12031": [{ fips: "36095", resRatio: 1.0 }],
  "12122": [{ fips: "36095", resRatio: 1.0 }],
  // Delaware, NY
  "13753": [{ fips: "36025", resRatio: 1.0 }],
  "13739": [{ fips: "36025", resRatio: 1.0 }],
  // Albany, NY
  "12207": [{ fips: "36001", resRatio: 1.0 }],
  "12210": [{ fips: "36001", resRatio: 1.0 }],
  // Schenectady
  "12305": [{ fips: "36093", resRatio: 1.0 }],
  // Onondaga / Syracuse
  "13202": [{ fips: "36067", resRatio: 1.0 }],
  // NYC examples
  "10001": [{ fips: "36061", resRatio: 1.0 }],
  "11201": [{ fips: "36047", resRatio: 1.0 }],
  // Multi-county example pattern (illustrative ratios)
  "12566": [
    { fips: "36071", resRatio: 0.62 },
    { fips: "36027", resRatio: 0.38 }
  ],
  // CA
  "90012": [{ fips: "06037", resRatio: 1.0 }],
  "94102": [{ fips: "06075", resRatio: 1.0 }],
  "92101": [{ fips: "06073", resRatio: 1.0 }],
  // TX
  "77002": [{ fips: "48201", resRatio: 1.0 }],
  "75201": [{ fips: "48113", resRatio: 1.0 }],
  // FL
  "33130": [{ fips: "12086", resRatio: 1.0 }],
  "32801": [{ fips: "12095", resRatio: 1.0 }],
  // IL
  "60601": [{ fips: "17031", resRatio: 1.0 }],
  // PA
  "19107": [{ fips: "42101", resRatio: 1.0 }],
  // WA
  "98101": [{ fips: "53033", resRatio: 1.0 }],
  // AZ
  "85004": [{ fips: "04013", resRatio: 1.0 }],
  // MA
  "02108": [{ fips: "25025", resRatio: 1.0 }],
  // CO
  "80202": [{ fips: "08031", resRatio: 1.0 }],
  // DC
  "20001": [{ fips: "11001", resRatio: 1.0 }]
};

let _zips = null;
let _meta = { source: "seed", version: "seed-0.5.0", count: 0 };

function load() {
  if (_zips) return _zips;
  _zips = { ...SEED_ZIPS };
  _meta.count = Object.keys(_zips).length;
  _meta.loadedAt = new Date().toISOString();

  const fullPath = path.join(__dirname, "hud-zip-county.json");
  try {
    if (fs.existsSync(fullPath)) {
      const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (raw && raw.zips) {
        _zips = raw.zips;
        _meta = {
          source: "hud-zip-county.json",
          version: raw.version || "file",
          effectiveDate: raw.effectiveDate || null,
          count: Object.keys(_zips).length,
          loadedAt: new Date().toISOString()
        };
      }
    }
  } catch (e) {
    // keep seed
  }
  return _zips;
}

/**
 * Resolve a ZIP to one or more counties.
 * @returns {{ primary: object|null, all: object[], multiCounty: boolean, zip: string } | null}
 */
function resolveZip(zip) {
  if (!zip) return null;
  const z = String(zip).trim().slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;

  const entries = load()[z];
  if (!entries || !entries.length) return null;

  const sorted = [...entries].sort((a, b) => (b.resRatio || 0) - (a.resRatio || 0));
  const all = sorted.map(e => {
    const county = getByFips(e.fips);
    return {
      fips: e.fips,
      resRatio: e.resRatio != null ? e.resRatio : null,
      county: county || { fips: e.fips, name: null, state: null }
    };
  });

  return {
    zip: z,
    primary: all[0],
    all,
    multiCounty: all.length > 1
  };
}

function getMeta() {
  load();
  return { ..._meta };
}

module.exports = {
  resolveZip,
  getMeta,
  load
};
