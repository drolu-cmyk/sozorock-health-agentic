const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPVisualizationApi } = require('../server/cbcap-visualization-api');

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

test('visualization API returns a deterministic spec without receiving raw data values', async () => {
  const api = createCBCAPVisualizationApi();
  const result = await api.handle({
    question: 'compare_places',
    measure: {
      id: 'measure:access',
      name: 'Adults without health insurance',
      unit: 'percent',
      direction: 'adverse',
      comparisonPolicy: 'higher_is_concern',
    },
    itemCount: 10,
    hasConfidenceIntervals: true,
  }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.artifactFamily, 'interval_dot_plot');
  assert.equal(result.body.accessibility.nonvisualTableRequired, true);
});

test('raw values, arbitrary renderer code, and unknown measure fields are rejected', async () => {
  const api = createCBCAPVisualizationApi();
  const rawData = await api.handle({
    question: 'compare_places',
    values: [1, 2, 3],
  }, { workspaceActor: actor() });
  assert.equal(rawData.statusCode, 400);
  assert.match(rawData.body.error, /Unsupported visualization request field values/);

  const rendererCode = await api.handle({
    question: 'compare_places',
    rendererCode: '<script>alert(1)</script>',
  }, { workspaceActor: actor() });
  assert.equal(rendererCode.statusCode, 400);

  const measureLeak = await api.handle({
    question: 'compare_places',
    measure: {
      id: 'm', name: 'Measure', privateRows: ['secret'],
    },
  }, { workspaceActor: actor() });
  assert.equal(measureLeak.statusCode, 400);
  assert.match(measureLeak.body.error, /Unsupported measure field privateRows/);
});

test('blocked visualization decisions return 422 rather than rendering misleading output', async () => {
  const api = createCBCAPVisualizationApi();
  const result = await api.handle({
    question: 'time_change',
    measure: { id: 'm', name: 'Measure' },
    timePointCount: 4,
    comparableVintages: false,
  }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.status, 'blocked');
  assert.equal(result.body.artifactFamily, 'release_comparison_table');
});

test('validated evidence-agent identity may plan a nonconsequential visualization but cannot gain decision authority', async () => {
  const api = createCBCAPVisualizationApi();
  const result = await api.handle({ question: 'planning_alignment' }, {
    workspaceActor: actor({
      principalId: 'agent-1',
      actorType: 'agent',
      role: 'evidence_agent',
    }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.artifactFamily, 'evidence_alignment_matrix');
  assert.equal(result.body.guardrails.some((item) => /official plan/.test(item)), true);
});

test('invalid actor fails closed before visualization planning', async () => {
  const api = createCBCAPVisualizationApi();
  const result = await api.handle({ question: 'planning_alignment' }, { workspaceActor: null });
  assert.equal(result.statusCode, 403);
});
