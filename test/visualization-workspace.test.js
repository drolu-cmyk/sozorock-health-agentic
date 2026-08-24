const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EVALUATION_COUNTY_FIPS,
  buildVisualizationWorkspace,
} = require('../packages/cbcap/visualization-workspace');

const RELEASE_ID = 'evaluation-release-v1';
const SOURCE_VERSION = {
  source_id: 'cdc-places',
  source_version_id: 'source-version:cdc-places-2025',
  publisher: 'Centers for Disease Control and Prevention',
  title: 'PLACES 2025 evaluation source',
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
const HRSA_SOURCE_VERSION = {
  ...SOURCE_VERSION,
  source_id: 'hrsa-workforce',
  source_version_id: 'source-version:hrsa-workforce-current',
  publisher: 'Health Resources and Services Administration',
  title: 'HRSA shortage areas evaluation source',
  official_url: 'https://data.hrsa.gov/',
  content_hash: `sha256:${'b'.repeat(64)}`,
};

function semantics(sourceMeasureId, overrides = {}) {
  const adverse = {
    id: `measure:${sourceMeasureId}`,
    source_measure_id: sourceMeasureId,
    name: sourceMeasureId,
    description: 'Controlled visualization workspace fixture.',
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
    allowed_visualizations: [
      'choropleth',
      'ranked_dot',
      'distribution',
      'uncertainty_interval',
      'scatterplot',
      'bivariate_map',
      'barrier_matrix',
      'service_gap',
    ],
    review_status: 'verified',
  };
  return { ...adverse, ...overrides };
}

function geography(countyFips) {
  return {
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
}

function measure(countyFips, semantic, numericValue, options = {}) {
  const source = options.sourceVersion || SOURCE_VERSION;
  return {
    id: `observation:${countyFips}:${semantic.source_measure_id}`,
    semantics: semantic,
    geography: geography(countyFips),
    source_version: source,
    geography_level: 'county',
    value: options.value === undefined ? numericValue : options.value,
    numeric_value: numericValue,
    confidence_low: options.confidenceLow ?? null,
    confidence_high: options.confidenceHigh ?? null,
    margin_of_error: options.marginOfError ?? null,
    data_period_start: source.data_period_start,
    data_period_end: source.data_period_end,
    source_metadata: options.sourceMetadata || {},
    review_status: 'verified',
  };
}

function countyPackage(countyFips, index, options = {}) {
  const lackTransport = semantics('LACKTRPT:Crude');
  const food = semantics('FOODINSECU:Crude');
  const hpsa = semantics('HPSA_DESIGNATION', {
    id: 'measure:HPSA_DESIGNATION',
    name: 'Current HPSA designation',
    direction: 'contextual',
    higher_value_meaning: 'context_dependent',
    unit: 'designation',
    universe: 'Official HRSA designation records',
    adjustment: 'not_applicable',
    comparison_policy: 'context_only',
    allowed_visualizations: ['designation_overlay', 'service_gap'],
  });
  const definitions = [lackTransport, food, hpsa];
  const measures = [
    ...(options.omitTransportation ? [] : [measure(countyFips, lackTransport, 8 + index, { confidenceLow: 6 + index, confidenceHigh: 10 + index })]),
    measure(countyFips, food, 11 + index),
    measure(countyFips, hpsa, null, {
      sourceVersion: HRSA_SOURCE_VERSION,
      value: 'primary_care_hpsa',
      sourceMetadata: { wholeCounty: index % 2 === 0, discipline: 'primary_care' },
    }),
  ];
  const coverage = [
    {
      id: `coverage:${countyFips}:places`,
      source_id: 'cdc-places',
      source_version_id: SOURCE_VERSION.source_version_id,
      geography_id: `county:${countyFips}`,
      coverage_key: 'places:hrsn',
      status: options.partialTransportation ? 'partial' : 'complete_with_records',
      records_matched: options.partialTransportation ? 0 : 2,
      evaluated_at: '2026-08-24T00:00:00Z',
      review_status: 'verified',
      caveat: options.partialTransportation ? 'Controlled partial-coverage fixture.' : null,
    },
    {
      id: `coverage:${countyFips}:hrsa`,
      source_id: 'hrsa-workforce',
      source_version_id: HRSA_SOURCE_VERSION.source_version_id,
      geography_id: `county:${countyFips}`,
      coverage_key: 'hpsa:primary_care',
      status: 'complete_with_records',
      records_matched: 1,
      evaluated_at: '2026-08-24T00:00:00Z',
      review_status: 'verified',
      caveat: null,
    },
  ];
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: options.releaseId || RELEASE_ID,
    releaseHash: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
    countyFips,
    sourceVersions: [SOURCE_VERSION, HRSA_SOURCE_VERSION],
    metricSemantics: definitions,
    measures,
    sourceCoverage: coverage,
  };
}

function fiveCountyPackages(options = {}) {
  return EVALUATION_COUNTY_FIPS.map((countyFips, index) => countyPackage(countyFips, index, {
    ...(index === 2 && options.partialThird ? { omitTransportation: true, partialTransportation: true } : {}),
  }));
}

test('five-county transportation comparison preserves release, source, uncertainty, selection, and export claim', () => {
  const workspace = buildVisualizationWorkspace({
    question: 'compare_places',
    sourceMeasureIds: ['LACKTRPT:Crude'],
    evidencePackages: fiveCountyPackages(),
    selectedCountyFips: '36093',
  });
  assert.equal(workspace.releaseId, RELEASE_ID);
  assert.deepEqual(workspace.countyFips, EVALUATION_COUNTY_FIPS);
  assert.equal(workspace.plan.artifactFamily, 'interval_dot_plot');
  assert.equal(workspace.permission, 'uncertainty_interval');
  assert.equal(workspace.linkedState.selectedCountyFips, '36093');
  assert.equal(workspace.linkedState.inspector.countyFips, '36093');
  assert.equal(workspace.accessibility.essentialValuesVisibleWithoutHover, true);
  assert.equal(workspace.export.claimId, workspace.claimId);
  assert.equal(workspace.export.sameAnalyticalClaimRequired, true);
  assert.equal(workspace.ledger.packages.length, 5);
  assert.ok(workspace.ledger.observations.every((item) => item.sourceVersionId === SOURCE_VERSION.source_version_id));
  assert.ok(workspace.data.every((row) => row.values[0].observation.confidenceLow !== null));
});

test('partial HRSN coverage remains unavailable and is never rendered as zero', () => {
  const workspace = buildVisualizationWorkspace({
    question: 'compare_places',
    sourceMeasureIds: ['LACKTRPT:Crude'],
    evidencePackages: fiveCountyPackages({ partialThird: true }),
  });
  const partial = workspace.data.find((row) => row.countyFips === '36057').values[0];
  assert.equal(partial.state, 'unavailable_partial_coverage');
  assert.equal(partial.value, null);
  assert.equal(partial.numericValue, null);
  assert.equal(partial.observation, null);
  assert.equal(workspace.plan.dataProfile.hasMissingValues, true);
  assert.match(workspace.plan.requiredDisclosures.join(' '), /missingness/i);
});

test('bivariate map requires exactly two governed measures and exposes a decodable two-axis legend', () => {
  const workspace = buildVisualizationWorkspace({
    question: 'bivariate_map',
    sourceMeasureIds: ['LACKTRPT:Crude', 'FOODINSECU:Crude'],
    evidencePackages: fiveCountyPackages(),
  });
  assert.equal(workspace.plan.artifactFamily, 'bivariate_choropleth');
  assert.equal(workspace.permission, 'bivariate_map');
  assert.deepEqual(workspace.plan.legend.dimensions, [3, 3]);
  assert.equal(workspace.plan.legend.exactlyTwoMeasures, true);
  assert.equal(workspace.plan.legend.directAxisLabels, true);
  assert.match(workspace.plan.guardrails.join(' '), /exactly two reviewed measures/i);
});

test('service-gap view keeps observed layers and derived rule visibly distinct', () => {
  const workspace = buildVisualizationWorkspace({
    question: 'service_gap',
    sourceMeasureIds: ['LACKTRPT:Crude', 'HPSA_DESIGNATION'],
    evidencePackages: fiveCountyPackages(),
  });
  assert.equal(workspace.permission, 'service_gap');
  assert.equal(workspace.plan.artifactFamily, 'service_gap_map');
  assert.equal(workspace.plan.layers.observed.length, 2);
  assert.equal(workspace.plan.layers.derived.evidenceType, 'derived_rule');
  assert.equal(workspace.plan.layers.derived.score, null);
  assert.equal(workspace.plan.layers.derived.causal, false);
  assert.match(workspace.plan.requiredDisclosures.join(' '), /observed and derived/i);
});

test('non-trendable barrier measure cannot produce a time-series workspace', () => {
  assert.throws(() => buildVisualizationWorkspace({
    question: 'time_change',
    sourceMeasureIds: ['LACKTRPT:Crude'],
    evidencePackages: fiveCountyPackages(),
  }), /not approved|Trend visualization/i);
});

test('workspace rejects incompatible releases before visualization planning', () => {
  const packages = fiveCountyPackages();
  packages[4] = countyPackage('48029', 4, { releaseId: 'different-release' });
  assert.throws(() => buildVisualizationWorkspace({
    question: 'compare_places',
    sourceMeasureIds: ['LACKTRPT:Crude'],
    evidencePackages: packages,
  }), /cannot mix Evidence Gateway release IDs/i);
});

test('unregistered measure cannot be used merely because caller requests it', () => {
  const packages = fiveCountyPackages();
  for (const evidence of packages) {
    const unknown = semantics('NEW_UNREVIEWED:Crude', { id: 'measure:NEW_UNREVIEWED:Crude' });
    evidence.metricSemantics.push(unknown);
    evidence.measures.push(measure(evidence.countyFips, unknown, 22));
  }
  assert.throws(() => buildVisualizationWorkspace({
    question: 'compare_places',
    sourceMeasureIds: ['NEW_UNREVIEWED:Crude'],
    evidencePackages: packages,
  }), /not registered/i);
});

test('five evaluation counties are fixed as Albany, Schenectady, Montgomery, Chester, and Bexar FIPS', () => {
  assert.deepEqual(EVALUATION_COUNTY_FIPS, ['36001', '36093', '36057', '42029', '48029']);
});
