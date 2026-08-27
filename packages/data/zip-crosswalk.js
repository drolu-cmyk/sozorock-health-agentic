/**
 * Governed postal-input county selection.
 *
 * Preferred method: HUD USPS ZIP-to-county crosswalk.
 * Approved fallback: same-numbered Census ZCTA-to-county land-area proxy.
 * The fallback is never represented as exact USPS ZIP geography.
 */

const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { getByFips, isProduction } = require('./national-counties');

const HUD_DATA_PATH = path.join(__dirname, 'hud-zip-county.json');
const ZCTA_PROXY_DATA_PATH = path.join(__dirname, 'census-zcta-county-proxy.json.gz');
const MIN_HUD_ZIP_COUNT = 30000;
const MIN_HUD_COUNTY_COUNT = 3000;
const MIN_ZCTA_COUNT = 33000;
const MIN_ZCTA_COUNTY_COUNT = 3100;
const MIN_ZCTA_RELATIONSHIP_COUNT = 46000;
const SHA256 = /^[0-9a-f]{64}$/;
const ZCTA_CAVEAT = 'A postal ZIP Code is not a Census ZCTA. ZIP input uses the same-numbered Census ZCTA only as a county-selection proxy; it is not exact USPS ZIP geography.';

const SEED_ZIPS = Object.freeze({
  '12043': [{ fips: '36095', resRatio: 1 }],
  '13753': [{ fips: '36025', resRatio: 1 }],
  '12207': [{ fips: '36001', resRatio: 1 }],
  '12305': [{ fips: '36093', resRatio: 1 }],
  '12566': [{ fips: '36071', resRatio: 0.62 }, { fips: '36027', resRatio: 0.38 }],
  '90012': [{ fips: '06037', resRatio: 1 }],
  '94102': [{ fips: '06075', resRatio: 1 }],
  '77002': [{ fips: '48201', resRatio: 1 }],
  '33130': [{ fips: '12086', resRatio: 1 }],
  '60601': [{ fips: '17031', resRatio: 1 }],
  '98101': [{ fips: '53033', resRatio: 1 }],
  '20001': [{ fips: '11001', resRatio: 1 }],
});

let cache = null;

function validateCommon(raw, collectionName) {
  const issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { issues: ['artifact_not_object'], collection: {} };
  const collection = raw[collectionName];
  if (!collection || typeof collection !== 'object' || Array.isArray(collection)) issues.push(`${collectionName}_not_object`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.effectiveDate || ''))) issues.push('effective_date_invalid');
  return { issues, collection: collection && typeof collection === 'object' && !Array.isArray(collection) ? collection : {} };
}

function validateHudArtifact(raw, options = {}) {
  const requireNational = options.requireNational === true;
  const countyLookup = options.countyLookup || getByFips;
  const { issues, collection: zips } = validateCommon(raw, 'zips');
  if (raw?.method !== 'hud_usps_zip_county') issues.push('hud_method_invalid');
  if (!/^https:\/\/(?:www\.)?huduser\.gov\//.test(String(raw?.source?.url || ''))) issues.push('hud_source_url_invalid');
  if (!SHA256.test(String(raw?.source?.sha256 || ''))) issues.push('hud_source_sha256_invalid');
  const counties = new Set();
  let relationshipCount = 0;
  for (const [zip, entries] of Object.entries(zips)) {
    if (!/^\d{5}$/.test(zip)) issues.push(`zip_invalid:${zip}`);
    if (!Array.isArray(entries) || entries.length === 0) { issues.push(`zip_relationships_missing:${zip}`); continue; }
    const seen = new Set();
    let residentialTotal = 0;
    let addressTotal = 0;
    for (const entry of entries) {
      relationshipCount += 1;
      if (!/^\d{5}$/.test(String(entry?.fips || ''))) issues.push(`county_fips_invalid:${zip}`);
      if (seen.has(entry?.fips)) issues.push(`county_relationship_duplicate:${zip}:${entry?.fips}`);
      seen.add(entry?.fips);
      counties.add(entry?.fips);
      if (!Number.isFinite(entry?.resRatio) || entry.resRatio < 0 || entry.resRatio > 1) issues.push(`res_ratio_invalid:${zip}:${entry?.fips}`);
      else residentialTotal += entry.resRatio;
      if (entry?.totRatio !== undefined) {
        if (!Number.isFinite(entry.totRatio) || entry.totRatio < 0 || entry.totRatio > 1) issues.push(`tot_ratio_invalid:${zip}:${entry?.fips}`);
        else addressTotal += entry.totRatio;
      }
      if (requireNational && !countyLookup(entry?.fips)) issues.push(`county_reference_missing:${zip}:${entry?.fips}`);
    }
    if (residentialTotal > 1.001) issues.push(`res_ratio_total_invalid:${zip}`);
    if (addressTotal > 1.001) issues.push(`tot_ratio_total_invalid:${zip}`);
    if (residentialTotal <= 0 && addressTotal <= 0) issues.push(`allocation_ratio_missing:${zip}`);
  }
  const zipCount = Object.keys(zips).length;
  if (requireNational && zipCount < MIN_HUD_ZIP_COUNT) issues.push(`zip_coverage_below_threshold:${zipCount}`);
  if (requireNational && counties.size < MIN_HUD_COUNTY_COUNT) issues.push(`county_coverage_below_threshold:${counties.size}`);
  return { ok: issues.length === 0, issues, geographyCount: zipCount, countyCount: counties.size, relationshipCount, method: 'hud_usps_zip_county' };
}

function validateZctaProxyArtifact(raw, options = {}) {
  const requireNational = options.requireNational === true;
  const countyLookup = options.countyLookup || getByFips;
  const { issues, collection: zctas } = validateCommon(raw, 'zctas');
  if (raw?.method !== 'census_zcta_proxy') issues.push('zcta_proxy_method_invalid');
  if (raw?.schemaVersion !== 'sozorock.census-zcta-county-proxy.v1') issues.push('zcta_proxy_schema_invalid');
  if (!/^https:\/\/www2\.census\.gov\//.test(String(raw?.source?.url || ''))) issues.push('census_source_url_invalid');
  if (!SHA256.test(String(raw?.source?.sha256 || ''))) issues.push('census_source_sha256_invalid');
  if (!/^\d{4}$/.test(String(raw?.vintage || ''))) issues.push('census_vintage_invalid');
  if (raw?.caveat !== ZCTA_CAVEAT) issues.push('zip_zcta_caveat_invalid');
  const manifests = Array.isArray(raw?.source?.manifests) ? raw.source.manifests : [];
  if (manifests.length !== 51) issues.push('census_source_manifests_incomplete');
  const manifestStates = new Set();
  for (const manifest of manifests) {
    if (!/^\d{2}$/.test(String(manifest?.stateFips || '')) || manifestStates.has(manifest.stateFips)) issues.push(`census_manifest_state_invalid:${manifest?.stateFips || 'missing'}`);
    manifestStates.add(manifest?.stateFips);
    if (!/^https:\/\/www2\.census\.gov\/geo\/docs\/maps-data\/data\/grfc\//.test(String(manifest?.url || ''))) issues.push(`census_manifest_url_invalid:${manifest?.stateFips || 'missing'}`);
    if (!SHA256.test(String(manifest?.sha256 || ''))) issues.push(`census_manifest_sha256_invalid:${manifest?.stateFips || 'missing'}`);
    if (!Number.isInteger(manifest?.bytes) || manifest.bytes <= 0 || !Number.isInteger(manifest?.rows) || manifest.rows <= 0) issues.push(`census_manifest_counts_invalid:${manifest?.stateFips || 'missing'}`);
  }
  const counties = new Set();
  let relationshipCount = 0;
  for (const [zcta, entries] of Object.entries(zctas)) {
    if (!/^\d{5}$/.test(zcta)) issues.push(`zcta_invalid:${zcta}`);
    if (!Array.isArray(entries) || entries.length === 0) { issues.push(`zcta_relationships_missing:${zcta}`); continue; }
    const seen = new Set();
    let areaTotal = 0;
    for (const entry of entries) {
      relationshipCount += 1;
      if (!/^\d{5}$/.test(String(entry?.fips || ''))) issues.push(`county_fips_invalid:${zcta}`);
      if (seen.has(entry?.fips)) issues.push(`county_relationship_duplicate:${zcta}:${entry?.fips}`);
      seen.add(entry?.fips);
      counties.add(entry?.fips);
      if (!Number.isFinite(entry?.areaRatio) || entry.areaRatio < 0 || entry.areaRatio > 1) issues.push(`area_ratio_invalid:${zcta}:${entry?.fips}`);
      else areaTotal += entry.areaRatio;
      if (!Number.isFinite(entry?.landAreaSquareMeters) || entry.landAreaSquareMeters < 0) issues.push(`land_area_invalid:${zcta}:${entry?.fips}`);
      if (requireNational && !countyLookup(entry?.fips)) issues.push(`county_reference_missing:${zcta}:${entry?.fips}`);
    }
    if (areaTotal < 0.999 || areaTotal > 1.001) issues.push(`area_ratio_total_invalid:${zcta}`);
  }
  const geographyCount = Object.keys(zctas).length;
  if (raw?.source?.upstreamZctaCount !== geographyCount) issues.push('upstream_zcta_count_mismatch');
  if (raw?.source?.upstreamRelationshipCount !== relationshipCount) issues.push('upstream_relationship_count_mismatch');
  if (requireNational && geographyCount < MIN_ZCTA_COUNT) issues.push(`zcta_coverage_below_threshold:${geographyCount}`);
  if (requireNational && counties.size < MIN_ZCTA_COUNTY_COUNT) issues.push(`county_coverage_below_threshold:${counties.size}`);
  if (requireNational && relationshipCount < MIN_ZCTA_RELATIONSHIP_COUNT) issues.push(`relationship_coverage_below_threshold:${relationshipCount}`);
  return { ok: issues.length === 0, issues, geographyCount, countyCount: counties.size, relationshipCount, method: 'census_zcta_proxy' };
}

function parseArtifact(file, label) {
  try {
    const bytes = fs.readFileSync(file);
    const json = file.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
    return JSON.parse(json);
  }
  catch { throw new Error(`${label} artifact cannot be parsed.`); }
}

function loadPostalGeographyArtifact(options = {}) {
  const production = options.production ?? isProduction(options.env);
  if (fs.existsSync(HUD_DATA_PATH)) {
    const artifact = parseArtifact(HUD_DATA_PATH, 'HUD ZIP-county');
    const validation = validateHudArtifact(artifact, { requireNational: production });
    if (!validation.ok) throw new Error(`HUD ZIP-county artifact failed validation: ${validation.issues.join(',')}`);
    return { artifact, validation, source: path.basename(HUD_DATA_PATH), method: 'hud_usps_zip_county' };
  }
  if (fs.existsSync(ZCTA_PROXY_DATA_PATH)) {
    const artifact = parseArtifact(ZCTA_PROXY_DATA_PATH, 'Census ZCTA proxy');
    const validation = validateZctaProxyArtifact(artifact, { requireNational: production });
    if (!validation.ok) throw new Error(`Census ZCTA proxy artifact failed validation: ${validation.issues.join(',')}`);
    return { artifact, validation, source: path.basename(ZCTA_PROXY_DATA_PATH), method: 'census_zcta_proxy' };
  }
  if (production) throw new Error('Production postal geography artifact is missing.');
  return {
    artifact: { version: 'seed-1', effectiveDate: '1970-01-01', method: 'development_seed', zips: SEED_ZIPS, source: { url: 'development-seed', sha256: 'development-seed' } },
    validation: { ok: true, issues: [], geographyCount: Object.keys(SEED_ZIPS).length, countyCount: new Set(Object.values(SEED_ZIPS).flat().map((row) => row.fips)).size, relationshipCount: Object.values(SEED_ZIPS).flat().length, method: 'development_seed' },
    source: 'seed',
    method: 'development_seed',
  };
}

const loadZipArtifact = loadPostalGeographyArtifact;

function loaded() {
  if (!cache) cache = loadPostalGeographyArtifact();
  return cache;
}

function collection(value = loaded()) {
  return value.method === 'census_zcta_proxy' ? value.artifact.zctas : value.artifact.zips;
}

function load() {
  return collection();
}

function resolveZip(zip) {
  if (!zip) return null;
  const normalized = String(zip).trim().slice(0, 5);
  if (!/^\d{5}$/.test(normalized)) return null;
  const value = loaded();
  const entries = collection(value)[normalized];
  if (!entries?.length) return null;
  const sorted = [...entries].sort((left, right) => {
    if (value.method === 'census_zcta_proxy') return right.areaRatio - left.areaRatio || left.fips.localeCompare(right.fips);
    return right.resRatio - left.resRatio || (right.totRatio || 0) - (left.totRatio || 0) || left.fips.localeCompare(right.fips);
  });
  const all = sorted.map((entry) => ({
    fips: entry.fips,
    resRatio: entry.resRatio ?? null,
    totRatio: entry.totRatio ?? null,
    areaRatio: entry.areaRatio ?? null,
    landAreaSquareMeters: entry.landAreaSquareMeters ?? null,
    county: getByFips(entry.fips) || { fips: entry.fips, name: null, state: null },
  }));
  return {
    zip: normalized,
    inputKind: 'postal_code_input',
    resolvedGeographyKind: value.method === 'census_zcta_proxy' ? 'census_zcta_proxy' : 'usps_zip_crosswalk',
    method: value.method,
    caveat: value.method === 'census_zcta_proxy' ? value.artifact.caveat : null,
    primary: all[0],
    all,
    multiCounty: all.length > 1,
  };
}

function getMeta() {
  const value = loaded();
  const validator = value.method === 'census_zcta_proxy' ? validateZctaProxyArtifact : validateHudArtifact;
  return {
    source: value.source,
    method: value.method,
    resolvedGeographyKind: value.method === 'census_zcta_proxy' ? 'census_zcta_proxy' : value.method === 'hud_usps_zip_county' ? 'usps_zip_crosswalk' : 'development_seed',
    version: value.artifact.version || null,
    vintage: value.artifact.vintage || null,
    effectiveDate: value.artifact.effectiveDate || null,
    count: value.validation.geographyCount,
    countyCount: value.validation.countyCount,
    relationshipCount: value.validation.relationshipCount,
    coverageReady: value.source !== 'seed' && validator(value.artifact, { requireNational: true }).ok,
    caveat: value.method === 'census_zcta_proxy' ? value.artifact.caveat : null,
    sourceProvenance: value.artifact.source || null,
  };
}

function resetForTests() {
  cache = null;
}

module.exports = {
  HUD_DATA_PATH,
  MIN_HUD_COUNTY_COUNT,
  MIN_HUD_ZIP_COUNT,
  MIN_ZCTA_COUNT,
  MIN_ZCTA_COUNTY_COUNT,
  MIN_ZCTA_RELATIONSHIP_COUNT,
  SEED_ZIPS,
  ZCTA_CAVEAT,
  ZCTA_PROXY_DATA_PATH,
  getMeta,
  load,
  loadPostalGeographyArtifact,
  loadZipArtifact,
  resetForTests,
  resolveZip,
  validateHudArtifact,
  validateZipArtifact: validateHudArtifact,
  validateZctaProxyArtifact,
};
