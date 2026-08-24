const test = require('node:test');
const assert = require('node:assert/strict');
const { createTenantCBCAPRuntimeFactory } = require('../server/tenant-cbcap-runtime');

function actor(tenantId = 'tenant-a') {
  return {
    tenantId,
    principalId: 'reviewer-1',
    actorType: 'human',
    role: 'foundation_reviewer',
    access: 'owner',
    displayName: 'Reviewer One',
  };
}

function runMemory() {
  return {
    createRun() {},
    read() { return []; },
    latestCheckpoint() { return null; },
  };
}

function learningMemory(tenantId) {
  return {
    tenantId,
    recordTrajectory() {},
    evaluate() {},
    proposeCandidate() {},
    reviewCandidate() {},
  };
}

test('tenant runtime exposes governed learning memory only from actor-scoped factory', async () => {
  const seen = [];
  const factory = createTenantCBCAPRuntimeFactory({
    memoryForActor: () => runMemory(),
    learningMemoryForActor(resolvedActor) {
      seen.push(structuredClone(resolvedActor));
      return learningMemory(resolvedActor.tenantId);
    },
  });

  const runtime = await factory(actor('tenant-a'));
  assert.equal(runtime.learningEvaluationEnabled, true);
  assert.equal(runtime.learningMemory.tenantId, 'tenant-a');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tenantId, 'tenant-a');
  assert.equal(Object.prototype.hasOwnProperty.call(runtime, 'learningApi'), false);
});

test('tenant runtime rejects incomplete learning-memory adapters', async () => {
  const factory = createTenantCBCAPRuntimeFactory({
    memoryForActor: () => runMemory(),
    learningMemoryForActor: () => ({ recordTrajectory() {} }),
  });

  await assert.rejects(
    () => factory(actor()),
    /does not expose the governed learning-memory contract/i,
  );
});

test('tenant runtime leaves learning evaluation disabled when no learning factory is configured', async () => {
  const factory = createTenantCBCAPRuntimeFactory({ memoryForActor: () => runMemory() });
  const runtime = await factory(actor());
  assert.equal(runtime.learningEvaluationEnabled, false);
  assert.equal(runtime.learningMemory, null);
});
