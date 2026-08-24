const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPMonitoringApi } = require('../server/cbcap-monitoring-api');
const { InMemoryMonitoringFindingStore } = require('../packages/runtime/monitoring-findings');

const OLD = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;

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

function definition() {
  return {
    id: 'monitor-release',
    kind: 'evidence_release',
    subjectId: 'gateway:county:36001',
    geographyId: 'county:36001',
    reviewStatus: 'verified',
    reviewedBy: 'reviewer-1',
    reviewedAt: '2026-08-20T00:00:00.000Z',
    baseline: {
      fingerprint: OLD,
      observedAt: '2026-08-20T00:00:00.000Z',
      state: null,
      deadline: null,
      validThrough: null,
    },
  };
}

function snapshot(fingerprint = NEW) {
  return {
    kind: 'evidence_release',
    subjectId: 'gateway:county:36001',
    geographyId: 'county:36001',
    reviewStatus: 'verified',
    sourceAuthority: 'governed',
    fingerprint,
    observedAt: '2026-08-23T00:00:00.000Z',
    state: null,
    deadline: null,
    validThrough: null,
    sourceEntityIds: ['release-1'],
  };
}

test('monitoring request accepts only monitor identity and as-of date', async () => {
  let definitionCalls = 0;
  const api = createCBCAPMonitoringApi({
    async definitionForActor() { definitionCalls += 1; return definition(); },
    async snapshotForActor() { return snapshot(); },
  });
  const result = await api.handle({
    monitorId: 'monitor-release',
    asOf: '2026-08-23',
    snapshot: snapshot(),
  }, { workspaceActor: actor() });

  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /unsupported fields/i);
  assert.equal(definitionCalls, 0);
});

test('monitor definition and snapshot are loaded server-side and actionable findings persist', async () => {
  const store = new InMemoryMonitoringFindingStore({ tenantId: 'tenant-a', clock: () => '2026-08-23T12:00:00.000Z' });
  const seen = [];
  const api = createCBCAPMonitoringApi({
    async definitionForActor(resolvedActor, monitorId) {
      seen.push(['definition', resolvedActor.tenantId, monitorId]);
      return definition();
    },
    async snapshotForActor(resolvedActor, resolvedDefinition, context) {
      seen.push(['snapshot', resolvedActor.tenantId, resolvedDefinition.id, context.asOf]);
      return snapshot();
    },
    async findingStoreForActor(resolvedActor) {
      assert.equal(resolvedActor.tenantId, 'tenant-a');
      return store;
    },
  });

  const result = await api.handle({ monitorId: 'monitor-release', asOf: '2026-08-23' }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'change_detected');
  assert.equal(result.body.persistedFinding.findingKey, result.body.findingKey);
  assert.equal(store.list().length, 1);
  assert.deepEqual(seen, [
    ['definition', 'tenant-a', 'monitor-release'],
    ['snapshot', 'tenant-a', 'monitor-release', '2026-08-23'],
  ]);
});

test('no-change monitoring result is not persisted', async () => {
  const store = new InMemoryMonitoringFindingStore({ tenantId: 'tenant-a' });
  const api = createCBCAPMonitoringApi({
    async definitionForActor() { return definition(); },
    async snapshotForActor() { return snapshot(OLD); },
    async findingStoreForActor() { return store; },
  });
  const result = await api.handle({ monitorId: 'monitor-release', asOf: '2026-08-23' }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'no_change');
  assert.equal(result.body.persistedFinding, null);
  assert.equal(store.list().length, 0);
});

test('monitoring requires authenticated workspace actor', async () => {
  const api = createCBCAPMonitoringApi({
    async definitionForActor() { return definition(); },
    async snapshotForActor() { return snapshot(); },
  });
  const result = await api.handle({ monitorId: 'monitor-release' }, {});
  assert.equal(result.statusCode, 403);
});

test('provider failures fail closed and never become a synthetic no-change', async () => {
  const definitionFailure = createCBCAPMonitoringApi({
    async definitionForActor() { throw new Error('down'); },
    async snapshotForActor() { return snapshot(); },
  });
  const first = await definitionFailure.handle({ monitorId: 'monitor-release' }, { workspaceActor: actor() });
  assert.equal(first.statusCode, 503);

  const snapshotFailure = createCBCAPMonitoringApi({
    async definitionForActor() { return definition(); },
    async snapshotForActor() { throw new Error('down'); },
  });
  const second = await snapshotFailure.handle({ monitorId: 'monitor-release' }, { workspaceActor: actor() });
  assert.equal(second.statusCode, 503);
});
