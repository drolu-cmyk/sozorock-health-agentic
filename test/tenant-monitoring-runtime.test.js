const test = require('node:test');
const assert = require('node:assert/strict');
const { createTenantCBCAPRuntimeFactory } = require('../server/tenant-cbcap-runtime');

function actor() {
  return {
    tenantId: 'tenant-a',
    principalId: 'agent-1',
    actorType: 'agent',
    role: 'evidence_agent',
    access: 'viewer',
    displayName: 'Evidence Agent',
  };
}

function runMemory() {
  return { createRun() {}, read() { return []; }, latestCheckpoint() { return null; } };
}

test('monitoring capability is absent unless both governed definition and snapshot providers exist', async () => {
  const none = createTenantCBCAPRuntimeFactory({ memoryForActor: () => runMemory() });
  const noRuntime = await none(actor());
  assert.equal(noRuntime.monitoringIntelligenceEnabled, false);
  assert.equal(noRuntime.monitoringApi, null);

  const oneProvider = createTenantCBCAPRuntimeFactory({
    memoryForActor: () => runMemory(),
    monitoringDefinitionForActor: async () => null,
  });
  const stillDisabled = await oneProvider(actor());
  assert.equal(stillDisabled.monitoringIntelligenceEnabled, false);
  assert.equal(stillDisabled.monitoringApi, null);
});

test('tenant monitoring runtime delegates only to actor-scoped governed providers', async () => {
  const seen = [];
  const runtimeFactory = createTenantCBCAPRuntimeFactory({
    memoryForActor: () => runMemory(),
    monitoringDefinitionForActor: async (resolvedActor, monitorId) => {
      seen.push(['definition', resolvedActor.tenantId, monitorId]);
      return {
        id: monitorId,
        kind: 'evidence_release',
        subjectId: 'gateway:county:36001',
        geographyId: 'county:36001',
        reviewStatus: 'verified',
        reviewedBy: 'reviewer-1',
        reviewedAt: '2026-08-20T00:00:00.000Z',
        baseline: {
          fingerprint: `sha256:${'a'.repeat(64)}`,
          observedAt: '2026-08-20T00:00:00.000Z',
        },
      };
    },
    monitoringSnapshotForActor: async (resolvedActor, definition) => {
      seen.push(['snapshot', resolvedActor.tenantId, definition.id]);
      return {
        kind: definition.kind,
        subjectId: definition.subjectId,
        geographyId: definition.geographyId,
        reviewStatus: 'verified',
        sourceAuthority: 'governed',
        fingerprint: `sha256:${'a'.repeat(64)}`,
        observedAt: '2026-08-23T00:00:00.000Z',
        sourceEntityIds: ['release-1'],
      };
    },
  });
  const runtime = await runtimeFactory(actor());
  assert.equal(runtime.monitoringIntelligenceEnabled, true);
  const result = await runtime.monitoringApi.handle(
    { monitorId: 'monitor-release', asOf: '2026-08-23' },
    { workspaceActor: actor() },
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'no_change');
  assert.deepEqual(seen, [
    ['definition', 'tenant-a', 'monitor-release'],
    ['snapshot', 'tenant-a', 'monitor-release'],
  ]);
});
