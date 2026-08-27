#!/usr/bin/env node

/**
 * Reproducibly generates governed county and HUD ZIP-county runtime artifacts.
 * No network calls are made here: inputs must be retrieved from the documented
 * authoritative HTTPS locations, retained immutably, and supplied explicitly.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { validateCountyArtifact } = require('../packages/data/national-counties');
const { ZCTA_CAVEAT, validateHudArtifact, validateZctaProxyArtifact } = require('../packages/data/zip-crosswalk');

const CENSUS_COUNTY_URL = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip';
const HUD_CROSSWALK_URL = 'https://www.huduser.gov/portal/datasets/usps_crosswalk.html';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'packages', 'data');

const STATE_NAMES = Object.freeze({
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13', HI: '15',
  ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
  MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56',
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function argumentsOf(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('Arguments must be --name value pairs.');
    args[key.slice(2)] = value;
  }
  return args;
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field.trim()); field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim()); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, '').trim().toUpperCase());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function countyType(name) {
  return ['Parish', 'Borough', 'Census Area', 'Municipality', 'City and Borough'].find((type) => name.endsWith(type)) || 'County';
}

function countyName(name) {
  return name.replace(/\s+(City and Borough|Census Area|County|Parish|Borough|Municipality)$/i, '').trim();
}

function countiesFromGazetteer(input) {
  const rows = parseDelimited(input.toString('utf8'), '\t');
  const counties = {};
  for (const row of rows) {
    const fips = row.GEOID;
    const state = row.USPS;
    if (!/^\d{5}$/.test(fips) || !/^[A-Z]{2}$/.test(state)) throw new Error(`Invalid Census county row ${fips || '(missing GEOID)'}.`);
    if (!STATE_NAMES[state]) continue;
    counties[fips] = {
      fips,
      name: countyName(row.NAME),
      state,
      stateFips: STATE_NAMES[state],
      type: countyType(row.NAME),
      lat: Number(row.INTPTLAT),
      lng: Number(row.INTPTLONG),
    };
  }
  return counties;
}

function countiesFromIndex(input) {
  const raw = JSON.parse(input.toString('utf8'));
  if (!Array.isArray(raw.counties)) throw new Error('Imported Census county index has no counties array.');
  return Object.fromEntries(raw.counties.map((county) => [county.geoid, {
    fips: county.geoid,
    name: countyName(county.name),
    state: county.statePostalCode,
    stateFips: county.stateFips,
    type: county.countyEquivalentType,
    lat: county.internalPoint?.latitude,
    lng: county.internalPoint?.longitude,
  }]));
}

function buildCounties(args) {
  const inputPath = args['census-gazetteer'] || args['county-index'];
  if (!inputPath) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args['effective-date'] || '')) throw new Error('--effective-date YYYY-MM-DD is required.');
  const input = fs.readFileSync(path.resolve(inputPath));
  let officialSha = sha256(input);
  let sourceUrl = args['source-url'] || CENSUS_COUNTY_URL;
  let counties;
  let upstreamManifest = null;
  if (args['county-index']) {
    if (!args['source-manifest']) throw new Error('--source-manifest is required with --county-index.');
    upstreamManifest = JSON.parse(fs.readFileSync(path.resolve(args['source-manifest']), 'utf8'));
    const source = upstreamManifest.sources?.find((item) => item.id === 'counties');
    if (!source?.sha256 || !source?.url) throw new Error('Source manifest lacks Census county provenance.');
    officialSha = source.sha256;
    sourceUrl = source.url;
    counties = countiesFromIndex(input);
  } else counties = countiesFromGazetteer(input);
  if (args['census-gazetteer']) {
    if (!/^[0-9a-f]{64}$/.test(args['source-sha256'] || '')) throw new Error('--source-sha256 for the original Census ZIP is required.');
    officialSha = args['source-sha256'];
  }

  const artifact = {
    schemaVersion: 'sozorock.national-counties.v1',
    version: `Census-${args.vintage || '2025'}`,
    vintage: args.vintage || '2025',
    effectiveDate: args['effective-date'],
    generatedAt: args['generated-at'] || new Date().toISOString(),
    source: {
      publisher: 'United States Census Bureau',
      url: sourceUrl,
      releaseDate: args['effective-date'],
      sha256: officialSha,
      importedArtifactSha256: sha256(input),
      importedArtifact: path.basename(inputPath),
      upstreamManifestContentSha256: upstreamManifest?.contentSha256 || null,
    },
    counties,
  };
  const validation = validateCountyArtifact(artifact, { requireNational: true });
  if (!validation.ok) throw new Error(`County artifact failed validation: ${validation.issues.join(',')}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'national-counties.full.json'), `${JSON.stringify(artifact)}\n`);
  return validation;
}

function buildHud(args) {
  if (!args['hud-csv']) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args['effective-date'] || '')) throw new Error('--effective-date YYYY-MM-DD is required.');
  const inputPath = path.resolve(args['hud-csv']);
  const input = fs.readFileSync(inputPath);
  const rows = parseDelimited(input.toString('utf8'), ',');
  const zips = {};
  let outsideReleaseScope = 0;
  for (const row of rows) {
    const zip = String(row.ZIP || '').padStart(5, '0');
    const fips = String(row.COUNTY || '').padStart(5, '0');
    const resRatio = Number(row.RES_RATIO);
    const totRatio = Number(row.TOT_RATIO);
    if (!/^\d{5}$/.test(zip) || !/^\d{5}$/.test(fips) || !Number.isFinite(resRatio) || !Number.isFinite(totRatio)) throw new Error(`Invalid HUD row ${zip}/${fips}.`);
    if (!Object.values(STATE_NAMES).includes(fips.slice(0, 2))) { outsideReleaseScope += 1; continue; }
    (zips[zip] ||= []).push({ fips, resRatio, totRatio });
  }
  for (const entries of Object.values(zips)) entries.sort((left, right) => right.resRatio - left.resRatio || right.totRatio - left.totRatio || left.fips.localeCompare(right.fips));
  const artifact = {
    schemaVersion: 'sozorock.hud-zip-county.v1',
    version: args.release || `HUD-${args['effective-date']}`,
    effectiveDate: args['effective-date'],
    generatedAt: args['generated-at'] || new Date().toISOString(),
    method: 'hud_usps_zip_county',
    source: {
      publisher: 'HUD Office of Policy Development and Research / USPS',
      url: args['source-url'] || HUD_CROSSWALK_URL,
      releaseDate: args['effective-date'],
      sha256: sha256(input),
      importedArtifact: path.basename(inputPath),
      sourceRecordCount: rows.length,
      recordsOutsidePrimaryReleaseScope: outsideReleaseScope,
    },
    zips,
  };
  const validation = validateHudArtifact(artifact, { requireNational: true });
  if (!validation.ok) throw new Error(`HUD artifact failed validation: ${validation.issues.join(',')}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'hud-zip-county.json'), `${JSON.stringify(artifact)}\n`);
  return validation;
}

function buildZctaProxy(args) {
  if (!args['census-zcta-index']) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args['effective-date'] || '')) throw new Error('--effective-date YYYY-MM-DD is required.');
  const inputPath = path.resolve(args['census-zcta-index']);
  const input = fs.readFileSync(inputPath);
  const upstream = JSON.parse(input.toString('utf8'));
  if (upstream.schemaVersion !== 'sozorock.county-resolution-index.v2') throw new Error('Census ZCTA proxy requires county-resolution-index.v2.');
  if (!/^\d{4}$/.test(String(upstream.censusVintage || ''))) throw new Error('Census ZCTA proxy vintage is invalid.');
  if (!Array.isArray(upstream.source?.manifests) || upstream.source.manifests.length < 51) throw new Error('Census ZCTA source manifests are incomplete.');
  if (!upstream.zctas || typeof upstream.zctas !== 'object' || Array.isArray(upstream.zctas)) throw new Error('Census ZCTA relationships are missing.');

  const upstreamRelationshipCount = Object.values(upstream.zctas).reduce((sum, entries) => sum + entries.length, 0);

  const zctas = Object.fromEntries(Object.entries(upstream.zctas).map(([zcta, entries]) => [zcta, entries.map((entry) => ({
    fips: entry.countyGeoid,
    countyName: entry.countyName,
    state: entry.statePostalCode,
    areaRatio: entry.overlapAreaPercent / 100,
    populationRatio: entry.overlapPopulationPercent == null ? null : entry.overlapPopulationPercent / 100,
    landAreaSquareMeters: entry.landAreaSquareMeters,
  }))]));
  const artifact = {
    schemaVersion: 'sozorock.census-zcta-county-proxy.v1',
    version: `Census-ZCTA-${upstream.censusVintage}`,
    vintage: upstream.censusVintage,
    effectiveDate: args['effective-date'],
    generatedAt: args['generated-at'] || upstream.generatedAt || new Date().toISOString(),
    method: 'census_zcta_proxy',
    caveat: ZCTA_CAVEAT,
    source: {
      publisher: upstream.source.publisher,
      title: upstream.source.title,
      url: upstream.source.officialUrl,
      releaseDate: args['effective-date'],
      sha256: sha256(input),
      importedArtifact: path.basename(inputPath),
      upstreamSchemaVersion: upstream.schemaVersion,
      upstreamGeneratedAt: upstream.generatedAt,
      upstreamMethod: upstream.method,
      upstreamZipCaveat: upstream.zipCaveat,
      upstreamZctaCount: Object.keys(upstream.zctas).length,
      upstreamRelationshipCount,
      manifests: upstream.source.manifests,
    },
    zctas,
  };
  const validation = validateZctaProxyArtifact(artifact, { requireNational: true });
  if (!validation.ok) throw new Error(`Census ZCTA proxy failed validation: ${validation.issues.join(',')}`);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'census-zcta-county-proxy.json.gz'),
    gzipSync(`${JSON.stringify(artifact)}\n`, { level: 9 }),
  );
  return validation;
}

function main(argv = process.argv.slice(2)) {
  const args = argumentsOf(argv);
  const counties = buildCounties(args);
  const hud = buildHud(args);
  const zctaProxy = buildZctaProxy(args);
  if (!counties && !hud && !zctaProxy) throw new Error('Supply --census-gazetteer, --county-index, --hud-csv, or --census-zcta-index.');
  process.stdout.write(`${JSON.stringify({ counties, hud, zctaProxy }, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { CENSUS_COUNTY_URL, HUD_CROSSWALK_URL, argumentsOf, buildCounties, buildHud, buildZctaProxy, main, parseDelimited };
