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

test('production host exposes API routes but never the legacy demonstration frontend', async () => {
  const inner = express();
  inner.get('/', (_req, res) => res.type('html').send('<h1>Demonstration frontend</h1>'));
  inner.get('/api/example', (_req, res) => res.json({ ok: true }));

  await withServer(createProductionApiOnlyApp(inner), async (origin) => {
    const root = await fetch(`${origin}/`);
    assert.equal(root.status, 404);
    assert.equal((await root.text()).includes('Demonstration frontend'), false);

    const api = await fetch(`${origin}/api/example`);
    assert.equal(api.status, 200);
    assert.deepEqual(await api.json(), { ok: true });
  });
});
