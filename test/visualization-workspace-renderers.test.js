const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMapLibreRenderPackage,
  flattenWorkspaceRows,
  renderAccessibleWorkspaceHtml,
  renderBivariateLegendSvg,
  renderRankedDotSvg,
  renderVisualizationWorkspace,
} = require('../packages/cbcap/workspace-renderers');

function observation(countyFips, sourceMeasureId, numericValue, options = {}) {
  return {
    observationId: `observation:${countyFips}:${sourceMeasureId}`,
    name: options.name || sourceMeasureId,
    numericValue,
    value: numericValue,
    unit: options.unit || 'percent',
    confidenceLow: options.confidenceLow ?? null,
    confidenceHigh: options.confidenceHigh ?? null,
    marginOfError: options.marginOfError ?? null,
    geography: {
      id: `county:${countyFips}`,
      kind: 'county',
      display_name: options.geographyName || `County ${countyFips}`,
      vintage: '2025',
      review_status: 'verified',
    },
    sourceVersion: {
      source_id: 'cdc-places',
      source_version_id: 'source-version:cdc-places:2025',
      title: 'CDC PLACES County Data',
      release_label: '2025',
      release_date: '2025-12-04',
      review_status: 'verified',
    },
    sourceCoverage: [],
  };
}

function baseWorkspace(overrides = {}) {
  const sourceMeasureIds = overrides.sourceMeasureIds || ['LACKTRPT:Crude'];
  const rows = overrides.data || [
    {
      countyFips: '36001',
      geography: { id: 'county:36001', display_name: 'Albany County, New York', vintage: '2025' },
      values: [{
        sourceMeasureId: sourceMeasureIds[0],
        semanticsId: `measure:${sourceMeasureIds[0]}`,
        state: 'observed',
        value: 8.1,
        numericValue: 8.1,
        observation: observation('36001', sourceMeasureIds[0], 8.1, {
          geographyName: 'Albany County, New York',
          confidenceLow: 7.2,
          confidenceHigh: 9.0,
        }),
      }],
    },
    {
      countyFips: '36057',
      geography: null,
      values: [{
        sourceMeasureId: sourceMeasureIds[0],
        semanticsId: `measure:${sourceMeasureIds[0]}`,
        state: 'unavailable_partial_coverage',
        value: null,
        numericValue: null,
        observation: null,
      }],
    },
  ];
  return {
    contract: 'cbcap.visualization-workspace.v1',
    releaseId: 'release-1',
    permission: 'uncertainty_interval',
    question: 'compare_places',
    sourceMeasureIds,
    countyFips: rows.map((row) => row.countyFips),
    plan: {
      artifactFamily: 'interval_dot_plot',
      renderer: 'SVG',
      insightTitle: 'Where is lack of reliable transportation higher across the selected counties?',
    },
    data: rows,
    ledger: {
      packages: rows.map((row) => ({ countyFips: row.countyFips, releaseId: 'release-1', releaseHash: `sha256:${'a'.repeat(64)}` })),
      sourceVersions: [{
        source_id: 'cdc-places',
        source_version_id: 'source-version:cdc-places:2025',
        title: 'CDC PLACES County Data',
        release_label: '2025',
        release_date: '2025-12-04',
      }],
      metricSemantics: sourceMeasureIds.map((sourceMeasureId) => ({
        id: `measure:${sourceMeasureId}`,
        source_measure_id: sourceMeasureId,
        name: sourceMeasureId,
        unit: 'percent',
      })),
      observations: [],
    },
    linkedState: {
      selectedCountyFips: '36001',
      selectedSourceMeasureId: sourceMeasureIds[0],
    },
    mobile: { portraitOrder: ['insight_title', 'primary_visual', 'active_state_summary', 'details_sheet'] },
    export: { claimId: `sha256:${'b'.repeat(64)}`, sameAnalyticalClaimRequired: true },
    claimId: `sha256:${'b'.repeat(64)}`,
    ...overrides,
  };
}

test('ranked renderer uses authoritative workspace values, direct labels, and reviewed uncertainty', () => {
  const workspace = baseWorkspace();
  const svg = renderRankedDotSvg(workspace);
  assert.match(svg, /Albany County, New York/);
  assert.match(svg, />8\.1%</);
  assert.match(svg, /<line .*stroke="currentColor"/);
  assert.match(svg, /County 36057/);
  assert.match(svg, />Unavailable</);
  assert.doesNotMatch(svg, />0%</);
});

test('accessible fallback exposes essential values and sources without hover or color', () => {
  const html = renderAccessibleWorkspaceHtml(baseWorkspace());
  assert.match(html, /<table>/);
  assert.match(html, /Unavailable/);
  assert.match(html, /7\.2 to 9/);
  assert.match(html, /CDC PLACES County Data/);
});

test('flattened render rows retain the authoritative observation and missing state', () => {
  const rows = flattenWorkspaceRows(baseWorkspace());
  assert.equal(rows[0].observationId, 'observation:36001:LACKTRPT:Crude');
  assert.equal(rows[0].sourceVersionId, 'source-version:cdc-places:2025');
  assert.equal(rows[1].numericValue, null);
  assert.equal(rows[1].state, 'unavailable_partial_coverage');
});

test('MapLibre package uses governed geography IDs and never converts missing to numeric zero', () => {
  const workspace = baseWorkspace({
    question: 'spatial_pattern',
    permission: 'choropleth',
    plan: {
      artifactFamily: 'choropleth',
      renderer: 'MapLibre_vector_tiles',
      insightTitle: 'Reviewed spatial pattern',
    },
  });
  const package_ = buildMapLibreRenderPackage(workspace);
  assert.equal(package_.renderer, 'MapLibre GL JS');
  assert.equal(package_.joinKey, 'governed geography ID');
  assert.equal(package_.featureStateByGeography['county:36057']['LACKTRPT:Crude'].numericValue, null);
  assert.equal(package_.featureStateByGeography['county:36057']['LACKTRPT:Crude'].state, 'unavailable_partial_coverage');
  assert.equal(package_.missingEncoding.numericZeroIsMissing, false);
  assert.equal(package_.claimId, workspace.claimId);
});

test('bivariate render package has exactly two reviewed measures and a text-decodable 3x3 legend', () => {
  const measures = ['LACKTRPT:Crude', 'FOODINSECU:Crude'];
  const data = ['36001', '36057'].map((countyFips, countyIndex) => ({
    countyFips,
    geography: { id: `county:${countyFips}`, display_name: `County ${countyFips}`, vintage: '2025' },
    values: measures.map((sourceMeasureId, measureIndex) => ({
      sourceMeasureId,
      semanticsId: `measure:${sourceMeasureId}`,
      state: 'observed',
      value: 10 + countyIndex + measureIndex,
      numericValue: 10 + countyIndex + measureIndex,
      observation: observation(countyFips, sourceMeasureId, 10 + countyIndex + measureIndex),
    })),
  }));
  const workspace = baseWorkspace({
    question: 'bivariate_map',
    sourceMeasureIds: measures,
    permission: 'bivariate_map',
    data,
    countyFips: ['36001', '36057'],
    plan: {
      artifactFamily: 'bivariate_choropleth',
      renderer: 'MapLibre_vector_tiles',
      insightTitle: 'Where do transportation and food insecurity appear together?',
      legend: { type: 'bivariate_matrix', dimensions: [3, 3], directAxisLabels: true, exactlyTwoMeasures: true },
    },
    linkedState: { selectedCountyFips: '36001', selectedSourceMeasureId: measures[0] },
  });
  const legend = renderBivariateLegendSvg(workspace);
  const package_ = renderVisualizationWorkspace(workspace);
  assert.equal((legend.match(/<rect /g) || []).length, 9);
  assert.match(legend, /LACKTRPT:Crude/);
  assert.match(legend, /FOODINSECU:Crude/);
  assert.equal(package_.renderer, 'MapLibre GL JS');
  assert.match(package_.legendSvg, /Bivariate three by three legend/i);
});

test('render package preserves the exact workspace claim ID for static and interactive output', () => {
  const workspace = baseWorkspace();
  const package_ = renderVisualizationWorkspace(workspace);
  assert.equal(package_.claimId, workspace.claimId);
  assert.equal(package_.staticAndInteractiveClaimMatch, true);
  assert.deepEqual(package_.sourceLedger, workspace.ledger);
});
