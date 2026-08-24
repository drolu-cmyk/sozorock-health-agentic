const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPVisualizationWorkspaceApi } = require('../server/cbcap-visualization-workspace-api');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'planner-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'viewer',
    displayName: 'Planner One',
    ...overrides,
  };
}

function evidence(countyFips = '36001') {
  const semantic = {
    id: 'measure:LACKTRPT:Crude',
    source_measure_id: 'LACKTRPT:Crude',
    name: 'Lack of reliable transportation',
    description: 'Controlled API fixture.',
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
    allowed_visualizations: ['choropleth', 'ranked_dot', 'uncertainty_interval', 'scatterplot', 'bivariate_map', 'barrier_matrix', 'service_gap'],
    review_status: 'verified',
  };
  const geography = {
    id: `county:${countyFips}`,
    kind: 'county',
    authority: 'census',
    authority_id: countyFips,
    name: `County ${countyFips}`,
    display_name: `County ${countyFips}`,
    state_fips: countyFips.slice(0, 2),
    county_fips: countyFips,
    vintage: '2025',
    valid_from: null,
    valid_to: null,
    review_status: 'verified',
    caveat: null,
  };
  const source = {
    source_id: 'cdc-places',
    source_version_id: 'source-version:cdc-places-2025',
    publisher: 'Centers for Disease Control and Prevention',
    title: 'PLACES 2025',
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
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'release-v1',
    releaseHash: `sha256:${countyFips.padEnd(64, '0').slice(0, 64)}`,
    countyFips,
    sourceVersions: [source],
    metricSemantics: [semantic],
    measures: [{
      id: `observation:${countyFips}:transportation`,
      semantics: semantic,
      geography,
      source_version: source,
      geography_level: 'county',
      value: 12,
      numeric_value: 12,
      confidence_low: 10,
      confidence_high: 14,
      margin_of_error: 2,
      data_period_start: '2023-01-01',
      data_period_end: '2023-12-31',
      source_metadata: {},
      review_status: 'verified',
    }],
    sourceCoverage: [{
      id: `coverage:${countyFips}`,
      source_id: 'cdc-places',
      source_version_id: source.source_version_id,
      geography_id: geography.id,
      coverage_key: 'places:hrsn',
      status: 'complete_with_records',
      records_matched: 1,
      evaluated_at: '2026-08-24T00:00:00Z',
      review_status: 'verified',
      caveat: null,
    }],
  };
}

test('workspace API fetches governed evidence itself, renders it, and never accepts caller-supplied values', async () => {
  const fetched = [];
  const api = createCBCAPVisualizationWorkspaceApi({
    evidenceClient: {
      async getCountyPackage(countyFips) {
        fetched.push(countyFips);
        return evidence(countyFips);
      },
    },
  });
  const result = await api.handle({
    question: 'compare_places',
    countyFips: ['36001', '36093'],
    sourceMeasureIds: ['LACKTRPT:Crude'],
    selectedCountyFips: '36093',
  }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(fetched, ['36001', '36093']);
  assert.equal(result.body.plan.artifactFamily, 'interval_dot_plot');
  assert.equal(result.body.linkedState.selectedCountyFips, '36093');
  assert.equal(result.body.renderPackage.contract, 'cbcap.visualization-render-package.v1');
  assert.equal(result.body.renderPackage.renderer, 'SVG');
  assert.equal(result.body.renderPackage.claimId, result.body.claimId);
  assert.equal(result.body.renderPackage.staticAndInteractiveClaimMatch, true);
  assert.match(result.body.renderPackage.svg, /role="img"/);
  assert.match(result.body.renderPackage.svg, /County 36001/);
  assert.match(result.body.renderPackage.accessibleHtml, /Sources and vintages/);

  const injected = await api.handle({
    question: 'compare_places',
    countyFips: ['36001'],
    sourceMeasureIds: ['LACKTRPT:Crude'],
    values: [999],
  }, { workspaceActor: actor() });
  assert.equal(injected.statusCode, 400);
  assert.match(injected.body.error, /Unsupported visualization workspace field values/);
});

test('unsupported visualization job is rejected before evidence is fetched', async () => {
  let calls = 0;
  const api = createCBCAPVisualizationWorkspaceApi({
    evidenceClient: { async getCountyPackage() { calls += 1; return evidence(); } },
  });
  const result = await api.handle({
    question: 'generic_dashboard',
    countyFips: ['36001'],
    sourceMeasureIds: ['LACKTRPT:Crude'],
  }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 400);
  assert.equal(calls, 0);
});

test('invalid actor is denied before request parsing or evidence fetch', async () => {
  let calls = 0;
  const api = createCBCAPVisualizationWorkspaceApi({
    evidenceClient: { async getCountyPackage() { calls += 1; return evidence(); } },
  });
  const result = await api.handle({
    question: 'compare_places',
    countyFips: ['not-fips'],
    sourceMeasureIds: ['LACKTRPT:Crude'],
  }, { workspaceActor: null });
  assert.equal(result.statusCode, 403);
  assert.equal(calls, 0);
});

test('Evidence Gateway failure returns 503 without fabricating a workspace', async () => {
  const api = createCBCAPVisualizationWorkspaceApi({
    evidenceClient: { async getCountyPackage() { throw new Error('gateway down'); } },
  });
  const result = await api.handle({
    question: 'compare_places',
    countyFips: ['36001'],
    sourceMeasureIds: ['LACKTRPT:Crude'],
  }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 503);
  assert.match(result.body.error, /Evidence Gateway packages are unavailable/);
});

test('semantic-policy rejection returns 422 rather than rendering a forbidden trend', async () => {
  const api = createCBCAPVisualizationWorkspaceApi({
    evidenceClient: { async getCountyPackage(countyFips) { return evidence(countyFips); } },
  });
  const result = await api.handle({
    question: 'time_change',
    countyFips: ['36001'],
    sourceMeasureIds: ['LACKTRPT:Crude'],
  }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 422);
  assert.match(result.body.error, /not approved|Trend visualization/i);
});
