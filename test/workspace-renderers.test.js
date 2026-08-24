const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalyticalWorkspace } = require('../packages/cbcap/analytical-workspace');
const {
  buildMapLibreRenderPackage,
  renderBivariateLegendSvg,
  renderRankedDotSvg,
  renderWorkspacePackage,
} = require('../packages/cbcap/workspace-renderers');

function measure(id, allowed) {
  return {
    id,
    semantics: {
      id: `semantics:${id}`,
      source_measure_id: id,
      name: id,
      unit: 'percent',
      universe: 'Adults',
      direction: 'adverse',
      comparison_policy: 'higher_is_concern',
      trendable: false,
      forecastable: false,
      aggregatable: false,
      allowed_geography_kinds: ['county'],
      allowed_visualizations: allowed,
      review_status: 'verified',
    },
    sourceVersion: {
      source_id: 'reviewed-source',
      source_version_id: 'source-version:reviewed:2025',
      title: 'Reviewed source',
      release_label: '2025',
      release_date: '2025-12-01',
      review_status: 'verified',
    },
  };
}

function request(question, measures, options = {}) {
  const geographies = [
    { id: 'county:36001', kind: 'county', display_name: 'Albany County, New York', vintage: '2025', review_status: 'verified' },
    { id: 'county:36057', kind: 'county', display_name: 'Montgomery County, New York', vintage: '2025', review_status: 'verified' },
  ];
  const observations = [];
  geographies.forEach((geography, i) => measures.forEach((m, j) => observations.push({
    id: `obs:${i}:${j}`,
    measureId: m.id,
    geographyId: geography.id,
    value: i === 1 && options.missing ? null : 10 + i + j,
    numericValue: i === 1 && options.missing ? null : 10 + i + j,
    valueState: i === 1 && options.missing ? 'unavailable' : 'observed',
    confidenceLow: options.interval ? 9 + i + j : null,
    confidenceHigh: options.interval ? 11 + i + j : null,
    sourceCoverageStatus: i === 1 && options.missing ? 'partial' : 'complete_with_records',
  })));
  return {
    requestId: `request:${question}`,
    question,
    scope: 'tenant_private',
    releaseId: 'release-1',
    releaseHash: `sha256:${'a'.repeat(64)}`,
    measures,
    geographies,
    observations,
    spatiallyMeaningful: options.spatial === true,
    hasBoundaryGeometry: options.spatial === true,
    normalizationStatus: 'valid',
  };
}

test('ranked renderer produces direct labels, values and uncertainty without hover', () => {
  const workspace = buildAnalyticalWorkspace(request('compare_places', [measure('ACCESS2:Crude', ['ranked_dot'])], { interval: true }));
  const svg = renderRankedDotSvg(workspace);
  assert.match(svg, /Albany County, New York/);
  assert.match(svg, /<line .*stroke="currentColor"/);
  assert.match(svg, />10%<|>11%</);
  assert.match(svg, /role="img"/);
});

test('unavailable observations stay textually unavailable in ranked output', () => {
  const workspace = buildAnalyticalWorkspace(request('compare_places', [measure('ACCESS2:Crude', ['ranked_dot'])], { missing: true }));
  const svg = renderRankedDotSvg(workspace);
  assert.match(svg, /Montgomery County, New York/);
  assert.match(svg, />Unavailable</);
  assert.doesNotMatch(svg, />0%<|>0</);
});

test('bivariate renderer returns MapLibre state plus a text-decodable legend', () => {
  const workspace = buildAnalyticalWorkspace(request('bivariate_spatial', [
    measure('LACKTRPT:Crude', ['bivariate_map']),
    measure('FOODINSECU:Crude', ['bivariate_map']),
  ], { spatial: true }));
  const package_ = renderWorkspacePackage(workspace);
  assert.equal(package_.renderer, 'MapLibre GL JS');
  assert.equal(package_.joinKey, 'governed geography ID');
  assert.match(package_.legendSvg, /low\/low/);
  assert.match(package_.legendSvg, /high\/high/);
  assert.match(renderBivariateLegendSvg(workspace), /decodable|low\/low|high\/high/);
});

test('MapLibre package preserves missing as unavailable and uses the canonical inspector rows', () => {
  const workspace = buildAnalyticalWorkspace(request('spatial_pattern', [measure('ACCESS2:Crude', ['choropleth'])], { spatial: true, missing: true }));
  const package_ = buildMapLibreRenderPackage(workspace);
  assert.equal(package_.featureStateByGeography['county:36057']['ACCESS2:Crude'].value, null);
  assert.equal(package_.featureStateByGeography['county:36057']['ACCESS2:Crude'].valueState, 'unavailable');
  assert.equal(package_.missingEncoding.numericZeroIsMissing, false);
  assert.equal(package_.inspectorUsesCanonicalRows, true);
  assert.match(package_.lowBandwidthFallback, /Unavailable/);
});

test('render package carries the same evidence fingerprint and source ledger as the workspace', () => {
  const workspace = buildAnalyticalWorkspace(request('compare_places', [measure('ACCESS2:Crude', ['ranked_dot'])]));
  const package_ = renderWorkspacePackage(workspace);
  assert.equal(package_.dataFingerprint, workspace.plan.dataFingerprint);
  assert.deepEqual(package_.sourceLedger, workspace.plan.sourceLedger);
  assert.equal(package_.claim, workspace.export.claim);
});
