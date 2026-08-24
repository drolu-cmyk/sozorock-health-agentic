const test = require('node:test');
const assert = require('node:assert/strict');
const { selectVisualization } = require('../packages/cbcap/visualization-intelligence');

function measure(overrides = {}) {
  return {
    id: 'measure:access',
    name: 'Adults without health insurance',
    unit: 'percent',
    direction: 'adverse',
    comparisonPolicy: 'higher_is_concern',
    ...overrides,
  };
}

test('spatial pattern uses a choropleth only when geography is analytically meaningful and normalized', () => {
  const spec = selectVisualization({
    question: 'spatial_pattern',
    measure: measure(),
    geographyKind: 'county',
    spatiallyMeaningful: true,
    hasBoundaryGeometry: true,
    normalizationStatus: 'valid',
    hasMissingValues: true,
  });
  assert.equal(spec.status, 'renderable');
  assert.equal(spec.artifactFamily, 'choropleth');
  assert.equal(spec.renderer, 'MapLibre_vector_tiles');
  assert.ok(spec.encodings.some((item) => /missing/.test(item)));
  assert.ok(spec.requiredDisclosures.some((item) => /missingness/.test(item)));
  assert.equal(spec.accessibility.nonvisualTableRequired, true);
  assert.equal(spec.mobile.tapAndStepThroughSelection, true);
});

test('map is rejected when place is only a grouping variable', () => {
  const spec = selectVisualization({
    question: 'spatial_pattern',
    measure: measure(),
    spatiallyMeaningful: false,
    hasBoundaryGeometry: true,
    normalizationStatus: 'valid',
  });
  assert.equal(spec.status, 'fallback_required');
  assert.equal(spec.artifactFamily, 'dot_plot');
  assert.match(spec.guardrails.join(' '), /do not use a map merely/i);
});

test('choropleth is blocked when normalization is unresolved', () => {
  const spec = selectVisualization({
    question: 'spatial_pattern',
    measure: measure({ unit: 'count' }),
    spatiallyMeaningful: true,
    hasBoundaryGeometry: true,
    normalizationStatus: 'missing',
  });
  assert.equal(spec.status, 'blocked');
  assert.equal(spec.artifactFamily, 'not_renderable');
  assert.match(spec.guardrails.join(' '), /raw counts/i);
});

test('precise place comparison prefers interval dots when confidence intervals exist', () => {
  const spec = selectVisualization({
    question: 'compare_places',
    measure: measure(),
    itemCount: 12,
    hasConfidenceIntervals: true,
  });
  assert.equal(spec.artifactFamily, 'interval_dot_plot');
  assert.equal(spec.primaryRoute, 'sorted_interval_dot_plot');
  assert.ok(spec.encodings.some((item) => /confidence interval/.test(item)));
});

test('context-only measure cannot be presented as a best-to-worst ranking', () => {
  const spec = selectVisualization({
    question: 'compare_places',
    measure: measure({ comparisonPolicy: 'context_only', direction: 'contextual' }),
  });
  assert.match(spec.guardrails.join(' '), /neutral order/i);
});

test('trend is blocked across incomparable vintages', () => {
  const spec = selectVisualization({
    question: 'time_change',
    measure: measure(),
    timePointCount: 4,
    comparableVintages: false,
  });
  assert.equal(spec.status, 'blocked');
  assert.equal(spec.artifactFamily, 'release_comparison_table');
  assert.match(spec.guardrails.join(' '), /never draw a connecting line/i);
});

test('comparable repeated series use small-multiple lines rather than an overloaded chart', () => {
  const spec = selectVisualization({
    question: 'time_change',
    measure: measure(),
    timePointCount: 5,
    seriesCount: 6,
    comparableVintages: true,
  });
  assert.equal(spec.artifactFamily, 'small_multiple_line_chart');
  assert.equal(spec.primaryRoute, 'small_multiples');
});

test('distribution is not fabricated from summary estimates', () => {
  const spec = selectVisualization({ question: 'distribution', distributionAvailable: false });
  assert.equal(spec.status, 'blocked');
  assert.match(spec.guardrails.join(' '), /do not fabricate a distribution/i);
});

test('barrier heatmap preserves missingness and forbids an ungoverned composite score', () => {
  const spec = selectVisualization({
    question: 'barrier_matrix',
    itemCount: 20,
    hasMissingValues: true,
  });
  assert.equal(spec.artifactFamily, 'matrix_heatmap');
  assert.match(spec.encodings.join(' '), /missing\/unavailable/i);
  assert.match(spec.guardrails.join(' '), /composite barrier score/i);
});

test('planning alignment uses an evidence matrix and keeps evidence-record gaps distinct from plan omissions', () => {
  const spec = selectVisualization({ question: 'planning_alignment' });
  assert.equal(spec.artifactFamily, 'evidence_alignment_matrix');
  assert.match(spec.guardrails.join(' '), /not proof the official plan omits/i);
});

test('funding fit avoids gauges and single scores', () => {
  const spec = selectVisualization({ question: 'funding_fit' });
  assert.equal(spec.artifactFamily, 'funding_criteria_matrix');
  assert.match(spec.guardrails.join(' '), /no gauge or single funding score/i);
  assert.match(spec.guardrails.join(' '), /no eligibility verdict/i);
});

test('relationship graph requires governed edges', () => {
  const blocked = selectVisualization({ question: 'evidence_relationships', relationshipEdgesAvailable: false });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.artifactFamily, 'evidence_table');

  const allowed = selectVisualization({ question: 'evidence_relationships', relationshipEdgesAvailable: true });
  assert.equal(allowed.artifactFamily, 'node_link_evidence_graph');
  assert.match(allowed.guardrails.join(' '), /every edge must have a governed relationship/i);
});

test('all specs keep nonvisual, mobile, export, and anti-decoration requirements', () => {
  for (const question of ['compare_places', 'uncertainty', 'barrier_matrix', 'funding_fit']) {
    const spec = selectVisualization({ question, measure: measure(), hasConfidenceIntervals: true });
    assert.equal(spec.accessibility.nonvisualTableRequired, true);
    assert.equal(spec.mobile.primaryEvidenceBeforeControls, true);
    assert.equal(spec.export.staticImage, true);
    assert.match(spec.guardrails.join(' '), /no 3D perspective/i);
    assert.match(spec.guardrails.join(' '), /no rainbow magnitude scale/i);
    assert.match(spec.guardrails.join(' '), /no decorative animation/i);
  }
});
