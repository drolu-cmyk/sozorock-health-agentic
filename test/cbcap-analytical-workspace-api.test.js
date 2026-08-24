const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPVisualizationApi } = require('../server/cbcap-visualization-api');

const actor = {
  tenantId: 'tenant-a',
  principalId: 'planner-1',
  role: 'county_planner',
  access: 'owner',
};

function request() {
  return {
    requestId: 'workspace-request-1',
    question: 'compare_places',
    scope: 'tenant_private',
    releaseId: 'release-1',
    releaseHash: `sha256:${'a'.repeat(64)}`,
    measures: [{
      id: 'measure:transport',
      semantics: {
        id: 'semantics:transport',
        source_measure_id: 'LACKTRPT:Crude',
        name: 'Lack of reliable transportation',
        unit: 'percent',
        universe: 'Adults',
        direction: 'adverse',
        comparison_policy: 'higher_is_concern',
        trendable: false,
        forecastable: false,
        aggregatable: false,
        allowed_geography_kinds: ['county'],
        allowed_visualizations: ['ranked_dot'],
        review_status: 'verified',
      },
      sourceVersion: {
        source_id: 'cdc-places',
        source_version_id: 'source-version:cdc-places:2025',
        title: 'CDC PLACES County Data',
        release_label: '2025 release',
        release_date: '2025-12-04',
        data_period_start: '2024-01-01',
        data_period_end: '2024-12-31',
        official_url: 'https://example.invalid/source',
        review_status: 'verified',
      },
    }],
    geographies: [{
      id: 'county:36001',
      kind: 'county',
      display_name: 'Albany County, New York',
      vintage: '2025',
      review_status: 'verified',
    }],
    observations: [{
      id: 'obs:1',
      measureId: 'measure:transport',
      geographyId: 'county:36001',
      value: 8.1,
      numericValue: 8.1,
      valueState: 'modeled',
      confidenceLow: 7.2,
      confidenceHigh: 9.0,
      marginOfError: null,
      sourceCoverageStatus: 'complete_with_records',
    }],
  };
}

test('authenticated visualization API returns linked workspace for full governed request', async () => {
  const audits = [];
  const api = createCBCAPVisualizationApi({ auditSink: (event) => audits.push(event) });
  const result = await api.handle(request(), { workspaceActor: actor });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.contract, 'cbcap.analytical-workspace.v1');
  assert.equal(result.body.plan.artifactFamily, 'interval_dot_plot');
  assert.equal(result.body.plan.requiredVisualizationPermissions[0], 'ranked_dot');
  assert.equal(result.body.accessibleFallback.rows[0].numericValue, 8.1);
  assert.equal(audits[0].action, 'cbcap_analytical_workspace_created');
  assert.equal(audits[0].dataFingerprint, result.body.plan.dataFingerprint);
});

test('workspace request remains identity-gated', async () => {
  const api = createCBCAPVisualizationApi();
  const result = await api.handle(request(), {});
  assert.equal(result.statusCode, 403);
});

test('unreviewed visualization choice fails closed instead of silently substituting a chart', async () => {
  const input = request();
  input.measures[0].semantics.allowed_visualizations = ['choropleth'];
  const api = createCBCAPVisualizationApi();
  const result = await api.handle(input, { workspaceActor: actor });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /ranked_dot.*not reviewed/);
});
