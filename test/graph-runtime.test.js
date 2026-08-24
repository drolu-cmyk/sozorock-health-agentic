const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPGraph } = require('../packages/runtime/cbcap-graph');
const { GovernedHarness } = require('../packages/runtime/harness');
const { InMemoryRunMemory } = require('../packages/runtime/memory');

const HASH = `sha256:${'a'.repeat(64)}`;
const APPROVAL = {
  status: 'approved',
  decision: 'approve',
  by: 'reviewer-1',
  scope: 'county_plan',
  reviewedAt: '2026-08-24T00:00:00.000Z',
  objectId: 'run-1',
  evidenceReleaseId: 'release-2026-08-23',
};

function handlers(calls) {
  return {
    resolvePlace: async () => ({ countyFips: '36001', name: 'Albany County' }),
    loadEvidence: async () => ({
      contract: 'sozorock.evidence-gateway.v1',
      releaseId: 'release-2026-08-23',
      releaseHash: HASH,
      countyFips: '36001',
      sourceVersions: [{ id: 'places-2025' }],
      metricSemantics: [{ id: 'diabetes', direction: 'higher_is_adverse' }],
      measures: [{ id: 'diabetes', value: 10.2 }],
      sourceCoverage: [],
    }),
    synthesizeBarriers: async () => ({ findings: [{ id: 'transport', status: 'no_verified_data' }] }),
    organizePlan: async () => ({ evidenceState: 'published_public_estimate' }),
    buildScenario: async (_state, assumptions) => {
      calls.scenario += 1;
      return { status: 'scenario_output', assumptions };
    },
    draftBrief: async () => ({ title: 'Draft county planning brief' }),
    publish: async () => {
      calls.publish += 1;
      return { status: 'published' };
    },
  };
}

test('CB-CAP graph stops at human review and does not invent a scenario without user assumptions', async () => {
  const calls = { scenario: 0, publish: 0 };
  const graph = createCBCAPGraph({ handlers: handlers(calls) });
  const result = await graph.run({ type: 'county_plan', location: '36001' });

  assert.equal(result.status, 'awaiting_human_review');
  assert.equal(result.error.code, 'human_review_required');
  assert.equal(calls.scenario, 0);
  assert.equal(calls.publish, 0);
  assert.equal(result.scenario, undefined);
  assert.equal(result.evidence.releaseId, 'release-2026-08-23');
  assert.ok(result.trace.some((entry) => entry.nodeId === 'draft_brief'));
});

test('CB-CAP graph runs scenarios only from explicit user assumptions', async () => {
  const calls = { scenario: 0, publish: 0 };
  const graph = createCBCAPGraph({ handlers: handlers(calls) });
  const result = await graph.run({
    type: 'county_plan',
    location: '36001',
    assumptions: {
      uptakeRate: { source: 'user', value: 0.12 },
      months: { source: 'user', value: 12 },
    },
  });

  assert.equal(result.status, 'awaiting_human_review');
  assert.equal(calls.scenario, 1);
  assert.equal(calls.publish, 0);
  assert.equal(result.scenario.status, 'scenario_output');
});

test('CB-CAP graph publishes only when approval matches the exact run and evidence release', async () => {
  const calls = { scenario: 0, publish: 0 };
  const graph = createCBCAPGraph({ handlers: handlers(calls) });
  const result = await graph.run(
    { type: 'county_plan', location: '36001' },
    { runId: 'run-1', approval: APPROVAL },
  );

  assert.equal(result.status, 'approved_output');
  assert.equal(calls.publish, 1);
  assert.equal(result.output.status, 'published');
  assert.ok(result.trace.some((entry) => entry.nodeId === 'publish'));
});

test('publishing is blocked when approval is for a different run or release', () => {
  const harness = new GovernedHarness({ allowedNodes: ['publish'] });
  const state = {
    runId: 'run-1',
    evidence: { releaseId: 'release-2026-08-23' },
    approval: { ...APPROVAL, objectId: 'run-other' },
  };
  const blockedRun = harness.authorize({ nodeId: 'publish', state, step: 1 });
  assert.equal(blockedRun.ok, false);
  assert.equal(blockedRun.code, 'human_approval_required');

  const blockedRelease = harness.authorize({
    nodeId: 'publish',
    state: { ...state, approval: { ...APPROVAL, evidenceReleaseId: 'release-other' } },
    step: 1,
  });
  assert.equal(blockedRelease.ok, false);

  const allowed = harness.authorize({
    nodeId: 'publish',
    state: { ...state, approval: APPROVAL },
    step: 1,
  });
  assert.equal(allowed.ok, true);
});

test('run memory is append-only and sequence-stable', () => {
  let tick = 0;
  const memory = new InMemoryRunMemory({ clock: () => `t${++tick}` });
  memory.createRun({ product: 'cbcap' }, 'run-1');
  memory.append('run-1', { type: 'decision', value: { approved: false } });
  const first = memory.read('run-1');
  first[1].value.approved = true;
  const second = memory.read('run-1');

  assert.equal(second[1].value.approved, false);
  assert.deepEqual(second.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(second.map((event) => event.at), ['t1', 't2']);
});
