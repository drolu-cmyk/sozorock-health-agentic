const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createProductionApiOnlyApp } = require('../server/production-index');

async function withServer(app, callback) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('production host exposes institutional CB-CAP routes and API health but not root or legacy place', async () => {
  const inner = express();
  inner.get('/', (_req, res) => res.type('html').send('<h1>Demonstration frontend</h1>'));
  inner.post('/api/place', (_req, res) => res.json({ compositeBarrier: 77 }));
  inner.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  inner.post('/api/cbcap', (_req, res) => res.json({ ok: true }));

  await withServer(createProductionApiOnlyApp(inner), async (origin) => {
    const root = await fetch(`${origin}/`);
    assert.equal(root.status, 404);
    assert.equal((await root.text()).includes('Demonstration frontend'), false);

    const place = await fetch(`${origin}/api/place`, { method: 'POST' });
    assert.equal(place.status, 404);

    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const cbcap = await fetch(`${origin}/api/cbcap`, { method: 'POST' });
    assert.equal(cbcap.status, 200);
    assert.deepEqual(await cbcap.json(), { ok: true });
  });
});
