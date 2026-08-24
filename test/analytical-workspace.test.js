const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAnalyticalWorkspace,
  renderAccessibleWorkspaceHtml,
  selectWorkspaceGeography,
} = require('../packages/cbcap/analytical-workspace');

const FIVE_COUNTIES = [
  ['county:36001', 'Albany County, New York'],
  ['county:36093', 'Schenectady County, New York'],
  ['county:36057', 'Montgomery County, New York'],
  ['county:42029', 'Chester County, Pennsylvania'],
  ['county:48029', 'Bexar County, Texas'],
];

function semantics(id, sourceMeasureId, allowedVisualizations, overrides = {}) {
  return {
    id,
    source_measure_id: sourceMeasureId,
    name: overrides.name || sourceMeasureId,
    unit: overrides.unit || 'percent',
    universe: overrides.universe || 'Adults',
    direction: overrides.direction || 'adverse',
    comparison_policy: overrides.comparisonPolicy || 'higher_is_concern',
    trendable: overrides.trendable === true,
    forecastable: overrides.forecastable === true,
    aggregatable: overrides.aggregatable === true,
    allowed_geography_kinds: ['county'],
    allowed_visualizations: allowedVisualizations,
    review_status: 'verified',
  };
}

function measure(id, sem, source = 'cdc-places') {
  return {
    id,
    semantics: sem,
    sourceVersion: {
      source_id: source,
      source_version_id: `source-version:${source}:2025`,
      title: source === 'cdc-places' ? 'CDC PLACES County Data' : 'Reviewed source',
      release_label: '2025 release',
      release_date: '2025-12-04',
      data_period_start: '2024-01-01',
      data_period_end: '2024-12-31',
      official_url: 'https://example.invalid/source',
      review_status: 'verified',
    },
  };
}

function geographies() {
  return FIVE_COUNTIES.map(([id, name]) => ({
    id,
    kind: 'county',
    display_name: name,
    vintage: '2025',
    review_status: 'verified',
  }));
}

function observations(measureIds, options = {}) {
  const rows = [];
  FIVE_COUNTIES.forEach(([geographyId], geoIndex) => {
    measureIds.forEach((measureId, measureIndex) => {
      const unavailable = options.unavailableIndex === geoIndex && measureIndex === 0;
      rows.push({
        id: `obs:${geoIndex}:${measureIndex}`,
        measureId,
        geographyId,
        value: unavailable ? null : 5 + geoIndex * 3 + measureIndex,
        numericValue: unavailable ? null : 5 + geoIndex * 3 + measureIndex,
        valueState: unavailable ? 'unavailable' : (options.valueState || 'modeled'),
        confidenceLow: options.withInterval && !unavailable ? 4 + geoIndex : null,
        confidenceHigh: options.withInterval && !unavailable ? 7 + geoIndex : null,
        marginOfError: options.withMoe && !unavailable ? 1.2 : null,
        sourceCoverageStatus: unavailable ? 'partial' : 'complete_with_records',
        componentEvidenceIds: options.componentEvidenceIds || [],
        note: options.note || null,
      });
    });
  });
  return rows;
}

function request(question, measures, options = {}) {
  return {
    requestId: `request:${question}`,
    question,
    scope: options.scope || 'tenant_private',
    containsTenantPrivate: options.containsTenantPrivate === true,
    approvedPublicTransformation: options.approvedPublicTransformation === true,
    releaseId: 'release-five-counties-v1',
    releaseHash: `sha256:${'a'.repeat(64)}`,
    measures,
    geographies: geographies(),
    observations: options.observations || observations(measures.map((item) => item.id), options),
    spatiallyMeaningful: options.spatiallyMeaningful === true,
    hasBoundaryGeometry: options.hasBoundaryGeometry === true,
    comparableVintages: options.comparableVintages !== false,
    distributionAvailable: options.distributionAvailable === true,
    relationshipEdgesAvailable: options.relationshipEdgesAvailable === true,
    normalizationStatus: options.normalizationStatus || 'valid',
  };
}

test('transportation county comparison chooses a reviewed ranked view and preserves source vintage', () => {
  const transport = measure('m:transport', semantics('s:transport', 'LACKTRPT:Crude', ['choropleth', 'ranked_dot', 'distribution', 'uncertainty_interval', 'scatterplot', 'bivariate_map'], { name: 'Lack of reliable transportation' }));
  const workspace = buildAnalyticalWorkspace(request('compare_places', [transport]));
  assert.match(workspace.plan.artifactFamily, /dot_plot/);
  assert.deepEqual(workspace.plan.requiredVisualizationPermissions, ['ranked_dot']);
  assert.equal(workspace.plan.sourceLedger[0].sourceVersionId, 'source-version:cdc-places:2025');
  assert.equal(workspace.accessibleFallback.rows[0].geographyVintage, '2025');
});

test('county ranking question uses dot comparison rather than a map by reflex', () => {
  const transport = measure('m:transport', semantics('s:transport', 'LACKTRPT:Crude', ['ranked_dot']));
  const workspace = buildAnalyticalWorkspace(request('compare_places', [transport], { spatiallyMeaningful: true, hasBoundaryGeometry: true }));
  assert.match(workspace.plan.artifactFamily, /dot_plot/);
  assert.doesNotMatch(workspace.plan.artifactFamily, /map|choropleth/);
});

test('partial PLACES coverage renders unavailable geographies distinctly from zero', () => {
  const transport = measure('m:transport', semantics('s:transport', 'LACKTRPT:Crude', ['ranked_dot']));
  const workspace = buildAnalyticalWorkspace(request('compare_places', [transport], { unavailableIndex: 2 }));
  const unavailable = workspace.accessibleFallback.rows.find((row) => row.geographyId === 'county:36057');
  assert.equal(unavailable.numericValue, null);
  assert.equal(unavailable.displayValue, 'Unavailable');
  assert.equal(unavailable.sourceCoverageStatus, 'partial');
});

test('non-trendable metric cannot produce a time-series view even if data has repeated points', () => {
  const transport = measure('m:transport', semantics('s:transport', 'LACKTRPT:Crude', ['trend_line'], { trendable: false }));
  assert.throws(() => buildAnalyticalWorkspace(request('time_change', [transport], { note: '2025' })), /not reviewed for trend analysis/);
});

test('bivariate map requires exactly two reviewed measures and provides a decodable 3x3 legend', () => {
  const transport = measure('m:transport', semantics('s:transport', 'LACKTRPT:Crude', ['bivariate_map']));
  const food = measure('m:food', semantics('s:food', 'FOODINSECU:Crude', ['bivariate_map']));
  const workspace = buildAnalyticalWorkspace(request('bivariate_spatial', [transport, food], { spatiallyMeaningful: true, hasBoundaryGeometry: true }));
  assert.equal(workspace.plan.artifactFamily, 'bivariate_map');
  assert.equal(workspace.plan.legend.cells.length, 3);
  assert.equal(workspace.plan.legend.cells.flat().length, 9);
  assert.equal(workspace.plan.legend.decodableWithoutColor, true);

  assert.throws(
    () => buildAnalyticalWorkspace(request('bivariate_spatial', [transport], { spatiallyMeaningful: true, hasBoundaryGeometry: true })),
    /exactly two reviewed measures/,
  );
});

test('service-gap map keeps observed evidence and derived gap logic in separate ledger layers', () => {
  const access = measure('m:access', semantics('s:access', 'ACCESS2:Crude', ['choropleth']));
  const base = observations([access.id]);
  base.push({
    id: 'derived:gap:albany',
    measureId: access.id,
    geographyId: 'county:36001',
    value: 1,
    numericValue: 1,
    valueState: 'derived',
    confidenceLow: null,
    confidenceHigh: null,
    marginOfError: null,
    sourceCoverageStatus: 'complete_with_records',
    componentEvidenceIds: ['obs:0:0'],
    note: 'Derived planning rule',
  });
  const workspace = buildAnalyticalWorkspace(request('service_gap', [access], {
    observations: base,
    spatiallyMeaningful: true,
    hasBoundaryGeometry: true,
  }));
  assert.equal(workspace.plan.artifactFamily, 'service_gap_map');
  assert.ok(workspace.plan.layerLedger.observed.includes('obs:0:0'));
  assert.deepEqual(workspace.plan.layerLedger.derived[0].componentEvidenceIds, ['obs:0:0']);
  assert.match(workspace.plan.guardrails.join(' '), /derived.*distinct.*observed/i);
});

test('uncertainty-bearing measures retain intervals and MOE in inspector and fallback table', () => {
  const access = measure('m:access', semantics('s:access', 'ACCESS2:Crude', ['ranked_dot']));
  const workspace = buildAnalyticalWorkspace(request('compare_places', [access], { withInterval: true, withMoe: true }));
  assert.equal(workspace.panels.inspector.rows[0].marginOfError, 1.2);
  assert.notEqual(workspace.panels.inspector.rows[0].confidenceLow, null);
  assert.equal(workspace.accessibleFallback.uncertaintyIncluded, true);
  assert.match(renderAccessibleWorkspaceHtml(workspace), /MOE ±1\.2/);
});

test('five-county linked primary, comparison, inspector and export share one canonical value fingerprint', () => {
  const access = measure('m:access', semantics('s:access', 'ACCESS2:Crude', ['choropleth', 'ranked_dot']));
  const workspace = buildAnalyticalWorkspace(request('spatial_pattern', [access], { spatiallyMeaningful: true, hasBoundaryGeometry: true }));
  assert.equal(workspace.accessibleFallback.rows.length, 5);
  assert.equal(workspace.plan.dataFingerprint, workspace.export.dataFingerprint);
  assert.deepEqual(workspace.panels.primary.rows, workspace.panels.comparison.rows);

  const chester = selectWorkspaceGeography(workspace, 'county:42029');
  assert.equal(chester.linkedState.primaryViewSelection, 'county:42029');
  assert.equal(chester.linkedState.comparisonSelection, 'county:42029');
  assert.equal(chester.linkedState.inspectorSelection, 'county:42029');
  assert.equal(chester.panels.inspector.rows[0].geographyName, 'Chester County, Pennsylvania');
});

test('essential values remain available without hover and without color alone', () => {
  const access = measure('m:access', semantics('s:access', 'ACCESS2:Crude', ['ranked_dot']));
  const workspace = buildAnalyticalWorkspace(request('compare_places', [access]));
  assert.equal(workspace.accessibleFallback.essentialValuesVisibleWithoutHover, true);
  assert.equal(workspace.mobile.hoverRequired, false);
  const html = renderAccessibleWorkspaceHtml(workspace);
  assert.match(html, /<table>/);
  assert.match(html, /Albany County, New York/);
  assert.match(html, /Sources and vintages/);
});

test('static export preserves the same claim, rows and fingerprint as interactive workspace', () => {
  const access = measure('m:access', semantics('s:access', 'ACCESS2:Crude', ['ranked_dot']));
  const workspace = buildAnalyticalWorkspace(request('compare_places', [access]));
  assert.equal(workspace.export.claim, workspace.plan.claim);
  assert.deepEqual(workspace.export.rows, workspace.accessibleFallback.rows);
  assert.equal(workspace.export.dataFingerprint, workspace.plan.dataFingerprint);
  assert.equal(workspace.export.interactiveAndStaticClaimMatch, true);
});

test('public output rejects tenant-private layers without approved transformation', () => {
  const access = measure('m:access', semantics('s:access', 'ACCESS2:Crude', ['ranked_dot']));
  assert.throws(
    () => buildAnalyticalWorkspace(request('compare_places', [access], { scope: 'public', containsTenantPrivate: true })),
    /cannot enter a public visualization/,
  );
});
