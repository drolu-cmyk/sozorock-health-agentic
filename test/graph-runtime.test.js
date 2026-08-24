const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPGraph } = require('../packages/runtime/cbcap-graph');
const { GovernedHarness } = require('../packages/runtime/harness');
const { InMemoryRunMemory } = require('../packages/runtime/memory');

const HASH = `sha256:${'a'.repeat(64)}`;

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
    publish: async () => ({ status: 'published' }),
  };
}

test('CB-CAP graph stops at human review and does not invent a scenario without user assumptions', async () => {
  const calls = { scenario: 0 };
  const graph = createCBCAPGraph({ handlers: handlers(calls) });
  const result = await graph.run({ type: 'county_plan', location: '36001' });

  assert.equal(result.status, 'awaiting_human_review');
  assert.equal(result.error.code, 'human_review_required');
  assert.equal(calls.scenario, 0);
  assert.equal(result.scenario, undefined);
  assert.equal(result.evidence.releaseId, 'release-2026-08-23');
  assert.ok(result.trace.some((entry) => entry.nodeId === 'draft_brief'));
});

test('CB-CAP graph runs scenarios only from explicit user assumptions', async () => {
  const calls = { scenario: 0 };
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
  assert.equal(result.scenario.status, 'scenario_output');
});

test('publishing is blocked by the harness without explicit human approval', () => {
  const harness = new GovernedHarness({ allowedNodes: ['publish'] });
  const blocked = harness.authorize({ nodeId: 'publish', state: { approval: { status: 'required' } }, step: 1 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'human_approval_required');

  const allowed = harness.authorize({ nodeId: 'publish', state: { approval: { status: 'approved', by: 'reviewer' } }, step: 1 });
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
