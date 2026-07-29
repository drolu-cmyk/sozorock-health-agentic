/**
 * National County / FIPS Reference
 *
 * Contract: every U.S. county and county-equivalent is addressable by FIPS.
 * Seed includes counties across multiple states so resolution is not NY-only.
 *
 * Production path:
 *   1. Download Census county reference (gazetteer or TIGER)
 *   2. Place as data/national-counties.full.json
 *   3. Call loadFullCountyTable()
 *
 * Territories and county-equivalents (AK census areas, LA parishes, etc.)
 * are included in the full table; seed notes the policy below.
 */

const fs = require("fs");
const path = require("path");

/**
 * Policy for territories and county-equivalents:
 * - Include all 50 states + DC
 * - Include Puerto Rico municipios when present in Census files
 * - Include AK census areas / boroughs as county-equivalents
 * - Exclude purely statistical areas that are not county-equivalents
 */
const TERRITORY_POLICY = {
  includeDC: true,
  includePR: true,
  includeAKEquivalents: true,
  includeUSVI: false, // enable when boundary + indicator coverage exists
  includeGuam: false
};

/**
 * Multi-state seed (not exhaustive). Full table loaded from file when present.
 * Format: fips -> { fips, name, state, stateFips, type, lat, lng }
 */
const SEED = {
  // New York
  "36095": { fips: "36095", name: "Schoharie", state: "NY", stateFips: "36", type: "county", lat: 42.68, lng: -74.49 },
  "36025": { fips: "36025", name: "Delaware", state: "NY", stateFips: "36", type: "county", lat: 42.20, lng: -75.00 },
  "36001": { fips: "36001", name: "Albany", state: "NY", stateFips: "36", type: "county", lat: 42.60, lng: -73.97 },
  "36093": { fips: "36093", name: "Schenectady", state: "NY", stateFips: "36", type: "county", lat: 42.81, lng: -74.06 },
  "36067": { fips: "36067", name: "Onondaga", state: "NY", stateFips: "36", type: "county", lat: 43.00, lng: -76.19 },
  "36061": { fips: "36061", name: "New York", state: "NY", stateFips: "36", type: "county", lat: 40.78, lng: -73.97 },
  "36047": { fips: "36047", name: "Kings", state: "NY", stateFips: "36", type: "county", lat: 40.65, lng: -73.95 },
  // California
  "06037": { fips: "06037", name: "Los Angeles", state: "CA", stateFips: "06", type: "county", lat: 34.05, lng: -118.24 },
  "06075": { fips: "06075", name: "San Francisco", state: "CA", stateFips: "06", type: "county", lat: 37.77, lng: -122.42 },
  "06073": { fips: "06073", name: "San Diego", state: "CA", stateFips: "06", type: "county", lat: 32.72, lng: -117.16 },
  // Texas
  "48201": { fips: "48201", name: "Harris", state: "TX", stateFips: "48", type: "county", lat: 29.76, lng: -95.37 },
  "48113": { fips: "48113", name: "Dallas", state: "TX", stateFips: "48", type: "county", lat: 32.78, lng: -96.80 },
  "48029": { fips: "48029", name: "Bexar", state: "TX", stateFips: "48", type: "county", lat: 29.42, lng: -98.49 },
  // Florida
  "12086": { fips: "12086", name: "Miami-Dade", state: "FL", stateFips: "12", type: "county", lat: 25.76, lng: -80.19 },
  "12095": { fips: "12095", name: "Orange", state: "FL", stateFips: "12", type: "county", lat: 28.54, lng: -81.38 },
  // Illinois
  "17031": { fips: "17031", name: "Cook", state: "IL", stateFips: "17", type: "county", lat: 41.84, lng: -87.68 },
  // Pennsylvania
  "42101": { fips: "42101", name: "Philadelphia", state: "PA", stateFips: "42", type: "county", lat: 39.95, lng: -75.17 },
  // Ohio
  "39035": { fips: "39035", name: "Cuyahoga", state: "OH", stateFips: "39", type: "county", lat: 41.50, lng: -81.69 },
  // Georgia
  "13121": { fips: "13121", name: "Fulton", state: "GA", stateFips: "13", type: "county", lat: 33.75, lng: -84.39 },
  // Washington
  "53033": { fips: "53033", name: "King", state: "WA", stateFips: "53", type: "county", lat: 47.61, lng: -122.33 },
  // Arizona
  "04013": { fips: "04013", name: "Maricopa", state: "AZ", stateFips: "04", type: "county", lat: 33.45, lng: -112.07 },
  // Massachusetts
  "25025": { fips: "25025", name: "Suffolk", state: "MA", stateFips: "25", type: "county", lat: 42.36, lng: -71.06 },
  // Colorado
  "08031": { fips: "08031", name: "Denver", state: "CO", stateFips: "08", type: "county", lat: 39.74, lng: -104.99 },
  // District of Columbia
  "11001": { fips: "11001", name: "District of Columbia", state: "DC", stateFips: "11", type: "county_equivalent", lat: 38.91, lng: -77.04 }
};

let _table = null;
let _meta = {
  source: "seed",
  count: Object.keys(SEED).length,
  loadedAt: null,
  version: "seed-0.5.0"
};

function getTable() {
  if (_table) return _table;
  _table = { ...SEED };
  _meta.loadedAt = new Date().toISOString();

  // Attempt full file load
  const fullPath = path.join(__dirname, "national-counties.full.json");
  try {
    if (fs.existsSync(fullPath)) {
      const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (raw && raw.counties) {
        _table = raw.counties;
        _meta = {
          source: "national-counties.full.json",
          count: Object.keys(_table).length,
          loadedAt: new Date().toISOString(),
          version: raw.version || "file",
          effectiveDate: raw.effectiveDate || null
        };
      }
    }
  } catch (e) {
    // keep seed
  }
  return _table;
}

function getByFips(fips) {
  if (!fips) return null;
  const key = String(fips).padStart(5, "0");
  return getTable()[key] || null;
}

function resolveByName(name, state) {
  if (!name) return null;
  const n = String(name).toLowerCase().replace(/\s+county$/i, "").trim();
  const st = state ? String(state).toUpperCase() : null;
  const table = getTable();
  for (const rec of Object.values(table)) {
    if (rec.name.toLowerCase() === n) {
      if (!st || rec.state === st) return rec;
    }
  }
  return null;
}

function listStates() {
  const set = new Set();
  Object.values(getTable()).forEach(r => set.add(r.state));
  return [...set].sort();
}

function getMeta() {
  getTable();
  return { ..._meta, territoryPolicy: TERRITORY_POLICY };
}

module.exports = {
  getByFips,
  resolveByName,
  listStates,
  getMeta,
  getTable,
  TERRITORY_POLICY,
  SEED
};
