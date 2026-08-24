const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVisualizationWorkspace } = require('../packages/cbcap/visualization-workspace');
const { REVIEWED_SOURCE_MEASURES } = require('../packages/cbcap/barrier-registry');

const CDC = {
  source_id: 'cdc-places',
  source_version_id: 'source-version:cdc-places-2025',
  publisher: 'Centers for Disease Control and Prevention',
  title: 'CDC PLACES',
  official_url: 'https://www.cdc.gov/places/',
  release_label: '2025',
  release_date: '2025-12-04',
  data_period_start: '2023-01-01',
  data_period_end: '2023-12-31',
  retrieved_at: '2026-08-24T00:00:00Z',
  stale_after: '2027-01-01T00:00:00Z',
  content_hash: `sha256:${'a'.repeat(64)}`,
  schema_version: 'test.v1',
  review_status: 'verified',
};

const HRSA = {
  ...CDC,
  source_id: 'hrsa-workforce',
  source_version_id: 'source-version:hrsa-workforce-2025',
  publisher: 'Health Resources and Services Administration',
  title: 'HRSA Workforce',
  official_url: 'https://data.hrsa.gov/',
  content_hash: `sha256:${'b'.repeat(64)}`,
};

const TRANSPORT = {
  id: 'measure:LACKTRPT:Crude',
  source_measure_id: 'LACKTRPT:Crude',
  name: 'Lack of reliable transportation',
  description: 'Controlled source-specific coverage fixture.',
  direction: 'adverse',
  higher_value_meaning: 'adverse',
  unit: 'percent',
  universe: 'Adults',
  adjustment: 'modeled',
  comparison_policy: 'higher_is_concern',
  trendable: false,
  forecastable: false,
  aggregatable: false,
  allowed_geography_kinds: ['county'],
  allowed_visualizations: ['ranked_dot'],
  review_status: 'verified',
};

function geography(fips, name) {
  return {
    id: `county:${fips}`,
    kind: 'county',
    authority: 'census',
    authority_id: fips,
    name,
    display_name: name,
    state_fips: fips.slice(0, 2),
    county_fips: fips,
    vintage: '2025',
    valid_from: null,
    valid_to: null,
    review_status: 'verified',
    caveat: null,
  };
}

function observedPackage() {
  const fips = '36001';
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'release-source-specific-v1',
    releaseHash: `sha256:${'c'.repeat(64)}`,
    countyFips: fips,
    sourceVersions: [CDC, HRSA],
    metricSemantics: [TRANSPORT],
    measures: [{
      id: 'observation:36001:LACKTRPT',
      semantics: TRANSPORT,
      geography: geography(fips, 'Albany County, New York'),
      source_version: CDC,
      geography_level: 'county',
      value: 8.2,
      numeric_value: 8.2,
      confidence_low: null,
      confidence_high: null,
      margin_of_error: null,
      data_period_start: CDC.data_period_start,
      data_period_end: CDC.data_period_end,
      source_metadata: {},
      review_status: 'verified',
    }],
    sourceCoverage: [{
      id: 'coverage:36001:cdc',
      source_id: 'cdc-places',
      source_version_id: CDC.source_version_id,
      geography_id: 'county:36001',
      coverage_key: 'source:all',
      status: 'complete_with_records',
      records_matched: 1,
      evaluated_at: '2026-08-24T00:00:00Z',
      review_status: 'verified',
      caveat: null,
    }],
  };
}

function missingPackage() {
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'release-source-specific-v1',
    releaseHash: `sha256:${'d'.repeat(64)}`,
    countyFips: '36057',
    sourceVersions: [CDC, HRSA],
    metricSemantics: [TRANSPORT],
    measures: [],
    sourceCoverage: [
      {
        id: 'coverage:36057:cdc',
        source_id: 'cdc-places',
        source_version_id: CDC.source_version_id,
        geography_id: 'county:36057',
        coverage_key: 'source:all',
        status: 'complete_no_records',
        records_matched: 0,
        evaluated_at: '2026-08-24T00:00:00Z',
        review_status: 'verified',
        caveat: 'CDC source was evaluated and contains no compatible record.',
      },
      {
        id: 'coverage:36057:hrsa',
        source_id: 'hrsa-workforce',
        source_version_id: HRSA.source_version_id,
        geography_id: 'county:36057',
        coverage_key: 'hpsa:primary_care',
        status: 'partial',
        records_matched: 0,
        evaluated_at: '2026-08-24T00:00:00Z',
        review_status: 'verified',
        caveat: 'Unrelated HRSA coverage is intentionally partial.',
      },
    ],
  };
}

test('missing PLACES measure uses only CDC coverage and ignores unrelated partial HRSA coverage', () => {
  const workspace = buildVisualizationWorkspace({
    question: 'compare_places',
    sourceMeasureIds: ['LACKTRPT:Crude'],
    evidencePackages: [observedPackage(), missingPackage()],
  });
  const missing = workspace.data.find((row) => row.countyFips === '36057').values[0];
  assert.equal(missing.state, 'complete_no_records');
  assert.equal(missing.numericValue, null);
  assert.equal(missing.observation, null);
});

test('reviewed source policy binds PLACES and HRSA semantics to their authoritative source families', () => {
  assert.equal(REVIEWED_SOURCE_MEASURES['LACKTRPT:Crude'].sourceId, 'cdc-places');
  assert.equal(REVIEWED_SOURCE_MEASURES['ACCESS2:Crude'].sourceId, 'cdc-places');
  assert.equal(REVIEWED_SOURCE_MEASURES.HPSA_DESIGNATION.sourceId, 'hrsa-workforce');
  assert.equal(REVIEWED_SOURCE_MEASURES.MUA_P_DESIGNATION.sourceId, 'hrsa-workforce');
});
