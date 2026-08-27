/**
 * Census county and county-equivalent reference.
 *
 * Development and tests may use the small seed below. Production is fail-closed:
 * national-counties.full.json must be present, valid, and meet the national
 * coverage thresholds before any geography is resolved.
 */

const fs = require('node:fs');
const path = require('node:path');

const FULL_DATA_PATH = path.join(__dirname, 'national-counties.full.json');
const MIN_COUNTY_COUNT = 3144;
const MIN_STATE_AND_DC_COUNT = 51;
const FIPS = /^\d{5}$/;
const STATE_FIPS = /^\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const TERRITORY_POLICY = Object.freeze({
  includeDC: true,
  includePR: false,
  includeAKEquivalents: true,
  includeUSVI: false,
  includeGuam: false,
});

const SEED = Object.freeze({
  '36095': { fips: '36095', name: 'Schoharie', state: 'NY', stateFips: '36', type: 'County', lat: 42.68, lng: -74.49 },
  '36025': { fips: '36025', name: 'Delaware', state: 'NY', stateFips: '36', type: 'County', lat: 42.20, lng: -75.00 },
  '36001': { fips: '36001', name: 'Albany', state: 'NY', stateFips: '36', type: 'County', lat: 42.60, lng: -73.97 },
  '36093': { fips: '36093', name: 'Schenectady', state: 'NY', stateFips: '36', type: 'County', lat: 42.81, lng: -74.06 },
  '36057': { fips: '36057', name: 'Montgomery', state: 'NY', stateFips: '36', type: 'County', lat: 42.90, lng: -74.44 },
  '42029': { fips: '42029', name: 'Chester', state: 'PA', stateFips: '42', type: 'County', lat: 39.97, lng: -75.75 },
  '06037': { fips: '06037', name: 'Los Angeles', state: 'CA', stateFips: '06', type: 'County', lat: 34.05, lng: -118.24 },
  '48201': { fips: '48201', name: 'Harris', state: 'TX', stateFips: '48', type: 'County', lat: 29.76, lng: -95.37 },
  '48029': { fips: '48029', name: 'Bexar', state: 'TX', stateFips: '48', type: 'County', lat: 29.42, lng: -98.49 },
  '12086': { fips: '12086', name: 'Miami-Dade', state: 'FL', stateFips: '12', type: 'County', lat: 25.76, lng: -80.19 },
  '17031': { fips: '17031', name: 'Cook', state: 'IL', stateFips: '17', type: 'County', lat: 41.84, lng: -87.68 },
  '53033': { fips: '53033', name: 'King', state: 'WA', stateFips: '53', type: 'County', lat: 47.61, lng: -122.33 },
  '11001': { fips: '11001', name: 'District of Columbia', state: 'DC', stateFips: '11', type: 'County equivalent', lat: 38.91, lng: -77.04 },
});

let cache = null;

function isProduction(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function validateCountyArtifact(raw, options = {}) {
  const requireNational = options.requireNational === true;
  const issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: ['artifact_not_object'], count: 0, stateCount: 0 };
  if (!raw.counties || typeof raw.counties !== 'object' || Array.isArray(raw.counties)) issues.push('counties_not_object');
  if (!raw.source || typeof raw.source !== 'object') issues.push('source_metadata_missing');
  if (!/^https:\/\/www2\.census\.gov\//.test(String(raw.source?.url || ''))) issues.push('census_source_url_invalid');
  if (!SHA256.test(String(raw.source?.sha256 || ''))) issues.push('census_source_sha256_invalid');
  if (!/^\d{4}$/.test(String(raw.vintage || ''))) issues.push('vintage_invalid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.effectiveDate || ''))) issues.push('effective_date_invalid');

  const counties = raw.counties && typeof raw.counties === 'object' && !Array.isArray(raw.counties) ? raw.counties : {};
  const states = new Set();
  for (const [key, county] of Object.entries(counties)) {
    if (!FIPS.test(key) || county?.fips !== key) issues.push(`county_fips_invalid:${key}`);
    if (!STATE_FIPS.test(String(county?.stateFips || '')) || key.slice(0, 2) !== county?.stateFips) issues.push(`state_fips_invalid:${key}`);
    if (!/^[A-Z]{2}$/.test(String(county?.state || ''))) issues.push(`state_postal_invalid:${key}`);
    if (!String(county?.name || '').trim()) issues.push(`county_name_missing:${key}`);
    if (!Number.isFinite(county?.lat) || county.lat < -90 || county.lat > 90) issues.push(`latitude_invalid:${key}`);
    if (!Number.isFinite(county?.lng) || county.lng < -180 || county.lng > 180) issues.push(`longitude_invalid:${key}`);
    states.add(county?.stateFips);
  }
  const count = Object.keys(counties).length;
  if (requireNational && count < MIN_COUNTY_COUNT) issues.push(`county_coverage_below_threshold:${count}`);
  if (requireNational && states.size < MIN_STATE_AND_DC_COUNT) issues.push(`state_coverage_below_threshold:${states.size}`);
  for (const fips of ['36057', '42029']) if (!counties[fips]) issues.push(`required_county_missing:${fips}`);
  return { ok: issues.length === 0, issues, count, stateCount: states.size };
}

function loadCountyArtifact(options = {}) {
  const production = options.production ?? isProduction(options.env);
  if (!fs.existsSync(FULL_DATA_PATH)) {
    if (production) throw new Error('Production national county artifact is missing.');
    return {
      artifact: { version: 'seed-1', vintage: 'seed', effectiveDate: '1970-01-01', counties: SEED, source: { url: 'development-seed', sha256: 'development-seed' } },
      validation: { ok: true, issues: [], count: Object.keys(SEED).length, stateCount: new Set(Object.values(SEED).map((row) => row.stateFips)).size },
      source: 'seed',
    };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FULL_DATA_PATH, 'utf8'));
  } catch {
    throw new Error('National county artifact cannot be parsed.');
  }
  const validation = validateCountyArtifact(raw, { requireNational: production });
  if (!validation.ok) throw new Error(`National county artifact failed validation: ${validation.issues.join(',')}`);
  return { artifact: raw, validation, source: path.basename(FULL_DATA_PATH) };
}

function loaded() {
  if (!cache) cache = loadCountyArtifact();
  return cache;
}

function getTable() {
  return loaded().artifact.counties;
}

function getByFips(fips) {
  if (!fips) return null;
  const key = String(fips).padStart(5, '0');
  return getTable()[key] || null;
}

function resolveByName(name, state) {
  if (!name) return null;
  const normalized = String(name).toLowerCase().replace(/\s+(county|parish|borough|municipality|census area)$/i, '').trim();
  const postal = state ? String(state).toUpperCase() : null;
  for (const county of Object.values(getTable())) {
    const candidate = county.name.toLowerCase().replace(/\s+(county|parish|borough|municipality|census area)$/i, '').trim();
    if (candidate === normalized && (!postal || county.state === postal)) return county;
  }
  return null;
}

function listStates() {
  return [...new Set(Object.values(getTable()).map((county) => county.state))].sort();
}

function getMeta() {
  const value = loaded();
  return {
    source: value.source,
    version: value.artifact.version || null,
    vintage: value.artifact.vintage || null,
    effectiveDate: value.artifact.effectiveDate || null,
    count: value.validation.count,
    stateCount: value.validation.stateCount,
    coverageReady: value.source !== 'seed' && validateCountyArtifact(value.artifact, { requireNational: true }).ok,
    sourceProvenance: value.artifact.source || null,
    territoryPolicy: TERRITORY_POLICY,
  };
}

function resetForTests() {
  cache = null;
}

module.exports = {
  FULL_DATA_PATH,
  MIN_COUNTY_COUNT,
  MIN_STATE_AND_DC_COUNT,
  SEED,
  TERRITORY_POLICY,
  getByFips,
  getMeta,
  getTable,
  isProduction,
  listStates,
  loadCountyArtifact,
  resetForTests,
  resolveByName,
  validateCountyArtifact,
};
