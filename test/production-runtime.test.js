const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  createProductionEdge,
  parseAllowedHosts,
  productionPublishHandlerForActor,
} = require('../server/production-index');

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('production host allowlist rejects wildcards and URL-shaped values', () => {
  assert.throws(() => parseAllowedHosts('*'), /invalid/);
  assert.throws(() => parseAllowedHosts('https://api.cbcap.sozorockfoundation.org'), /invalid/);
  const hosts = parseAllowedHosts('api.cbcap.sozorockfoundation.org');
  assert.equal(hosts.has('api.cbcap.sozorockfoundation.org'), true);
});

test('production edge keeps institutional routes host-bound while health probes remain infrastructure-readable', async () => {
  const inner = express();
  inner.get('/api/protected', (_req, res) => res.json({ ok: true }));
  const app = createProductionEdge(inner, {
    allowedHosts: new Set(['api.cbcap.sozorockfoundation.org']),
    readinessProbe: async () => ({ ok: true }),
  });

  await withServer(app, async (base) => {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.match(health.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.ok(health.headers.get('x-request-id'));

    const denied = await fetch(`${base}/api/protected`, { headers: { Host: 'attacker.example' } });
    assert.equal(denied.status, 421);

    const allowed = await fetch(`${base}/api/protected`, { headers: { Host: 'api.cbcap.sozorockfoundation.org' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
  });
});

test('production readiness endpoint fails closed when database readiness fails', async () => {
  const inner = express();
  const app = createProductionEdge(inner, {
    allowedHosts: new Set(['api.cbcap.sozorockfoundation.org']),
    readinessProbe: async () => ({ ok: false }),
  });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/readyz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'not_ready' });
  });
});

test('production approval handler emits an internal governed artifact and rejects cross-tenant state', async () => {
  const actor = { tenantId: 'tenant-a', principalId: 'planner-a' };
  const handler = productionPublishHandlerForActor(actor);
  const output = await handler({
    tenantId: 'tenant-a',
    runId: 'run-1',
    countyFips: '36001',
    evidence: { releaseId: 'release-1' },
    approval: { status: 'approved' },
  });
  assert.equal(output.status, 'approved_artifact');
  assert.equal(output.externalPublication, false);
  assert.equal(output.tenantId, 'tenant-a');
  assert.equal(output.evidenceReleaseId, 'release-1');

  await assert.rejects(
    () => handler({ tenantId: 'tenant-b', runId: 'run-2', evidence: { releaseId: 'release-1' } }),
    /another tenant/,
  );
});
