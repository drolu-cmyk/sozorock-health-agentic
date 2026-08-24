const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');

async function withServer(options, fn) {
  const app = createApp({
    allowedOrigins: new Set(['https://cbcap.sozorockfoundation.org']),
    placeAPI: { async handle() { return { statusCode: 200, body: { status: 'ok' } }; } },
    cbcapService: { async handle() { return { statusCode: 202, body: { status: 'awaiting_human_review', runId: 'run-1' } }; } },
    ...options,
  });
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

test('POST /api/cbcap preserves governed service status', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/api/cbcap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: '36001' }),
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-powered-by'), null);
    const body = await response.json();
    assert.equal(body.status, 'awaiting_human_review');
  });
});

test('public audit and legacy session endpoints are closed by default', async () => {
  await withServer({}, async (base) => {
    const audit = await fetch(`${base}/api/audit`);
    assert.equal(audit.status, 404);

    const session = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: '36001' }),
    });
    assert.equal(session.status, 404);
  });
});

test('CORS is allowlisted and rejects disallowed preflight requests', async () => {
  await withServer({}, async (base) => {
    const allowed = await fetch(`${base}/api/health`, {
      headers: { Origin: 'https://cbcap.sozorockfoundation.org' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://cbcap.sozorockfoundation.org');
    assert.equal(allowed.headers.get('vary'), 'Origin');

    const denied = await fetch(`${base}/api/cbcap`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });
});

test('legacy sessions may be enabled only by explicit server configuration', async () => {
  await withServer({ enableLegacySessions: true }, async (base) => {
    const response = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: '36001' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.location, '36001');
  });
});
