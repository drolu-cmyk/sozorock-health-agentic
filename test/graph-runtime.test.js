const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPGraph } = require('../packages/runtime/cbcap-graph');
const { GovernedHarness } = require('../packages/runtime/harness');
const { InMemoryRunMemory } = require('../packages/runtime/memory');

const HASH = `sha256:${'a'.repeat(64)}`;

function approval(runId = 'run-1', releaseId = 'release-2026-08-23') {
  return {
    status: 'approved',
    decision: 'approve',
    by: 'reviewer-1',
    scope: 'county_plan',
    reviewedAt: '2026-08-24T00:00:00.000Z',
    objectId: runId,
    evidenceReleaseId: releaseId,
  };
}

function handlers(calls) {
  return {
    resolvePlace: async () => {
      calls.resolve += 1;
      return { countyFips: '36001', name: 'Albany County' };
    },
    loadEvidence: async () => {
      calls.evidence += 1;
      return {
        contract: 'sozorock.evidence-gateway.v1',
        releaseId: 'release-2026-08-23',
        releaseHash: HASH,
        countyFips: '36001',
        sourceVersions: [{ id: 'places-2025' }],
        metricSemantics: [{ id: 'diabetes', direction: 'higher_is_adverse' }],
        measures: [{ id: 'diabetes', value: 10.2 }],
        sourceCoverage: [],
      };
    },
    synthesizeBarriers: async () => ({ findings: [{ id: 'transport', status: 'no_verified_data' }] }),
    organizePlan: async () => ({ evidenceState: 'published_public_estimate' }),
    buildScenario: async (_state, assumptions) => {
      calls.scenario += 1;
      return { status: 'scenario_output', assumptions };
    },
    draftBrief: async () => {
      calls.draft += 1;
      return { title: 'Draft county planning brief' };
    },
    publish: async () => {
      calls.publish += 1;
      return { status: 'published' };
    },
  };
}

function counters() {
  return { resolve: 0, evidence: 0, scenario: 0, draft: 0, publish: 0 };
}

test('CB-CAP graph stops at a resumable human review checkpoint when publish exists', async () => {
  const calls = counters();
  const memory = new InMemoryRunMemory();
  const graph = createCBCAPGraph({ handlers: handlers(calls), memory });
  const result = await graph.run({ type: 'county_plan', location: '36001' }, { runId: 'run-review' });

  assert.equal(result.status, 'awaiting_human_review');
  assert.equal(result.error.code, 'human_review_required');
  assert.equal(calls.scenario, 0);
  assert.equal(calls.publish, 0);
  const checkpoint = memory.latestCheckpoint('run-review');
  assert.equal(checkpoint.status, 'awaiting_human_review');
  assert.equal(checkpoint.resumeAt, 'publish');
  assert.equal(checkpoint.state.evidence.releaseId, 'release-2026-08-23');
});

test('resume publishes the saved run without recomputing geography, evidence, or draft', async () => {
  const calls = counters();
  const memory = new InMemoryRunMemory();
  const graph = createCBCAPGraph({ handlers: handlers(calls), memory });
  const first = await graph.run({ type: 'county_plan', location: '36001' }, { runId: 'run-resume' });
  assert.equal(first.status, 'awaiting_human_review');
  assert.deepEqual(
    { resolve: calls.resolve, evidence: calls.evidence, draft: calls.draft, publish: calls.publish },
    { resolve: 1, evidence: 1, draft: 1, publish: 0 },
  );

  const resumed = await graph.resume('run-resume', {
    approval: approval('run-resume'),
  });

  assert.equal(resumed.status, 'approved_output');
  assert.equal(resumed.output.status, 'published');
  assert.equal(resumed.resumeCount, 1);
  assert.deepEqual(
    { resolve: calls.resolve, evidence: calls.evidence, draft: calls.draft, publish: calls.publish },
    { resolve: 1, evidence: 1, draft: 1, publish: 1 },
  );
  const events = memory.read('run-resume');
  assert.equal(events.filter((event) => event.type === 'run_resumed').length, 1);
  assert.equal(events.filter((event) => event.type === 'node_started' && event.nodeId === 'publish').length, 1);
  assert.equal(memory.latestCheckpoint('run-resume').resumeAt, null);
});

test('stale approval is rejected before the saved run is mutated and a correct approval can retry', async () => {
  const calls = counters();
  const memory = new InMemoryRunMemory();
  const graph = createCBCAPGraph({ handlers: handlers(calls), memory });
  await graph.run({ type: 'county_plan', location: '36001' }, { runId: 'run-retry' });
  const before = memory.read('run-retry');

  await assert.rejects(
    () => graph.resume('run-retry', { approval: approval('different-run') }),
    /Continuation rejected: human_approval_required/,
  );
  assert.equal(memory.read('run-retry').length, before.length);
  assert.equal(memory.latestCheckpoint('run-retry').resumeAt, 'publish');

  const result = await graph.resume('run-retry', { approval: approval('run-retry') });
  assert.equal(result.status, 'approved_output');
});

test('completed run cannot be resumed again', async () => {
  const calls = counters();
  const memory = new InMemoryRunMemory();
  const graph = createCBCAPGraph({ handlers: handlers(calls), memory });
  await graph.run({ type: 'county_plan', location: '36001' }, { runId: 'run-once' });
  await graph.resume('run-once', { approval: approval('run-once') });
  await assert.rejects(
    () => graph.resume('run-once', { approval: approval('run-once') }),
    /not awaiting a resumable human review/,
  );
});

test('concurrent review continuations claim the checkpoint exactly once', async () => {
  const calls = counters();
  const memory = new InMemoryRunMemory();
  const graph = createCBCAPGraph({ handlers: handlers(calls), memory });
  await graph.run({ type: 'county_plan', location: '36001' }, { runId: 'run-concurrent' });

  const outcomes = await Promise.allSettled([
    graph.resume('run-concurrent', { approval: approval('run-concurrent') }),
    graph.resume('run-concurrent', { approval: approval('run-concurrent') }),
  ]);

  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
  assert.match(outcomes.find((result) => result.status === 'rejected').reason.message, /already claimed/);
  assert.equal(calls.publish, 1);
  assert.equal(memory.read('run-concurrent').filter((event) => event.type === 'run_resumed').length, 1);
});

test('run() refuses to overwrite an existing run ID', async () => {
  const calls = counters();
  const memory = new InMemoryRunMemory();
  const graph = createCBCAPGraph({ handlers: handlers(calls), memory });
  await graph.run({ type: 'county_plan', location: '36001' }, { runId: 'run-existing' });
  await assert.rejects(
    () => graph.run({ type: 'county_plan', location: '36001' }, { runId: 'run-existing' }),
    /Use resume\(\) for an existing run/,
  );
});

test('CB-CAP graph runs scenarios only from explicit user assumptions plus scenario context', async () => {
  const calls = counters();
  const graph = createCBCAPGraph({ handlers: handlers(calls) });
  const result = await graph.run({
    type: 'county_plan',
    location: '36001',
    assumptions: {
      uptakeRate: { source: 'user', value: 0.12 },
      months: { source: 'user', value: 12 },
    },
    scenario: {
      asOf: '2026-08-23',
      horizonEnd: '2027-08-23',
    },
  });

  assert.equal(result.status, 'awaiting_human_review');
  assert.equal(calls.scenario, 1);
  assert.equal(calls.publish, 0);
  assert.equal(result.scenario.status, 'scenario_output');
});

test('publishing is blocked when approval is for a different run or release', () => {
  const harness = new GovernedHarness({ allowedNodes: ['publish'] });
  const valid = approval('run-1');
  const state = {
    runId: 'run-1',
    evidence: { releaseId: 'release-2026-08-23' },
    approval: { ...valid, objectId: 'run-other' },
  };
  const blockedRun = harness.authorize({ nodeId: 'publish', state, step: 1 });
  assert.equal(blockedRun.ok, false);
  assert.equal(blockedRun.code, 'human_approval_required');

  const blockedRelease = harness.authorize({
    nodeId: 'publish',
    state: { ...state, approval: { ...valid, evidenceReleaseId: 'release-other' } },
    step: 1,
  });
  assert.equal(blockedRelease.ok, false);

  const allowed = harness.authorize({
    nodeId: 'publish',
    state: { ...state, approval: valid },
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
