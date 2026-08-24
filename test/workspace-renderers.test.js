const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMapLibreRenderPackage,
  renderBivariateLegendSvg,
  renderVisualizationWorkspace,
} = require('../packages/cbcap/workspace-renderers');

function observation(countyFips, sourceMeasureId, numericValue, overrides = {}) {
  return {
    contract: 'cbcap.barrier-intelligence.v1',
    observationId: `observation:${countyFips}:${sourceMeasureId}`,
    barrierFamily: 'transportation_and_travel',
    semanticsId: `measure:${sourceMeasureId}`,
    sourceMeasureId,
    name: sourceMeasureId,
    value: numericValue,
    numericValue,
    unit: 'percent',
    universe: 'Adults',
    direction: 'adverse',
    higherValueMeaning: 'adverse',
    comparisonPolicy: 'higher_is_concern',
    dataPeriodStart: '2023-01-01',
    dataPeriodEnd: '2023-12-31',
    confidenceLow: overrides.confidenceLow ?? null,
    confidenceHigh: overrides.confidenceHigh ?? null,
    marginOfError: overrides.marginOfError ?? null,
    geography: {
      id: `county:${countyFips}`,
      kind: 'county',
      name: `County ${countyFips}`,
      display_name: `County ${countyFips}`,
      county_fips: countyFips,
      vintage: '2025',
      review_status: 'verified',
    },
    sourceVersion: {
      source_id: 'cdc-places',
      source_version_id: 'source-version:cdc-places-2025',
      title: 'PLACES 2025',
      release_label: '2025',
      release_date: '2025-12-04',
      review_status: 'verified',
    },
    sourceCoverage: [],
    coverageClass: 'partial_coverage',
    permissions: { allowedVisualizations: ['ranked_dot', 'bivariate_map'] },
    reviewStatus: 'verified',
  };
}

function workspace(artifactFamily = 'interval_dot_plot') {
  const firstMeasure = 'LACKTRPT:Crude';
  const secondMeasure = 'FOODINSECU:Crude';
  const data = ['36001', '36057'].map((countyFips, index) => ({
    countyFips,
    geography: { id: `county:${countyFips}`, name: `County ${countyFips}`, display_name: `County ${countyFips}`, vintage: '2025' },
    values: [
      {
        sourceMeasureId: firstMeasure,
        semanticsId: `measure:${firstMeasure}`,
        state: index === 1 ? 'unavailable_partial_coverage' : 'observed',
        value: index === 1 ? null : 12,
        numericValue: index === 1 ? null : 12,
        observation: index === 1 ? null : observation(countyFips, firstMeasure, 12, { confidenceLow: 10, confidenceHigh: 14 }),
      },
      {
        sourceMeasureId: secondMeasure,
        semanticsId: `measure:${secondMeasure}`,
        state: 'observed',
        value: 18 + index,
        numericValue: 18 + index,
        observation: observation(countyFips, secondMeasure, 18 + index),
      },
    ],
  }));
  return {
    contract: 'cbcap.visualization-workspace.v1',
    releaseId: 'release-v1',
    question: artifactFamily === 'bivariate_choropleth' ? 'bivariate_map' : 'compare_places',
    sourceMeasureIds: artifactFamily === 'bivariate_choropleth' ? [firstMeasure, secondMeasure] : [firstMeasure],
    countyFips: ['36001', '36057'],
    plan: {
      insightTitle: 'Reviewed county comparison',
      artifactFamily,
      renderer: artifactFamily === 'bivariate_choropleth' ? 'MapLibre_vector_tiles' : 'svg_or_declarative_chart',
    },
    data,
    ledger: {
      packages: [],
      sourceVersions: [{ source_id: 'cdc-places', source_version_id: 'source-version:cdc-places-2025', title: 'PLACES 2025', release_label: '2025', release_date: '2025-12-04' }],
      metricSemantics: [
        { id: `measure:${firstMeasure}`, source_measure_id: firstMeasure, name: firstMeasure, unit: 'percent' },
        { id: `measure:${secondMeasure}`, source_measure_id: secondMeasure, name: secondMeasure, unit: 'percent' },
      ],
      observations: [],
    },
    linkedState: { selectedCountyFips: '36001', selectedSourceMeasureId: firstMeasure },
    mobile: { portraitOrder: ['insight_title', 'primary_visual', 'active_state_summary', 'details_sheet'] },
    export: { claimId: `sha256:${'c'.repeat(64)}` },
    claimId: `sha256:${'c'.repeat(64)}`,
  };
}

test('ranked render package keeps values and uncertainty visible without hover', () => {
  const package_ = renderVisualizationWorkspace(workspace());
  assert.equal(package_.renderer, 'SVG');
  assert.equal(package_.staticAndInteractiveClaimMatch, true);
  assert.match(package_.svg, /role="img"/);
  assert.match(package_.svg, /County 36001/);
  assert.match(package_.svg, /10.*14/);
  assert.match(package_.accessibleHtml, /Unavailable/);
  assert.match(package_.accessibleHtml, /Sources and vintages/);
});

test('bivariate render package exposes MapLibre feature state and text-decodable 3x3 legend', () => {
  const current = workspace('bivariate_choropleth');
  const package_ = renderVisualizationWorkspace(current);
  assert.equal(package_.renderer, 'MapLibre GL JS');
  assert.equal(package_.joinKey, 'governed geography ID');
  assert.equal(package_.featureStateByGeography['county:36057']['LACKTRPT:Crude'].numericValue, null);
  assert.equal(package_.featureStateByGeography['county:36057']['LACKTRPT:Crude'].state, 'unavailable_partial_coverage');
  assert.equal(package_.missingEncoding.numericZeroIsMissing, false);
  assert.match(package_.legendSvg, /Bivariate three by three legend/i);
  assert.match(package_.legendSvg, /LACKTRPT:Crude/);
  assert.match(package_.legendSvg, /FOODINSECU:Crude/);
  assert.match(renderBivariateLegendSvg(current), /High/);
});

test('MapLibre render package uses the same claim ID and canonical evidence state', () => {
  const current = workspace('bivariate_choropleth');
  const package_ = buildMapLibreRenderPackage(current);
  assert.equal(package_.claimId, current.claimId);
  assert.equal(package_.inspectorUsesCanonicalEvidenceRows, true);
  assert.equal(package_.linkedSelection, '36001');
  assert.match(package_.lowBandwidthFallback, /Essential values, missingness, uncertainty/);
});
