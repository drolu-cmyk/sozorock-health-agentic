const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');

async function withServer(options, fn) {
  const app = createApp({
    allowedOrigins: new Set(['https://cbcap.sozorockfoundation.org']),
    placeAPI: { async handle() { return { statusCode: 200, body: { status: 'ok' } }; } },
    cbcapAPI: { async handle() { return { statusCode: 202, body: { status: 'awaiting_human_review', runId: 'run-1' } }; } },
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

test('POST /api/cbcap preserves governed API status and disables caching', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/api/cbcap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: '36001' }),
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const body = await response.json();
    assert.equal(body.status, 'awaiting_human_review');
  });
});

test('public audit, legacy session, and review endpoints are closed by default', async () => {
  await withServer({}, async (base) => {
    const audit = await fetch(`${base}/api/audit`);
    assert.equal(audit.status, 404);

    const session = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: '36001' }),
    });
    assert.equal(session.status, 404);

    const review = await fetch(`${base}/api/cbcap/runs/run-1/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(review.status, 404);
  });
});

test('review route is mounted only when a configured review service is injected', async () => {
  let seenContext = false;
  const cbcapReviewAPI = {
    async handle(runId, body, context) {
      seenContext = Boolean(context?.request);
      assert.equal(runId, 'run-1');
      assert.deepEqual(body, { decision: 'approve' });
      return { statusCode: 200, body: { status: 'approved_output', runId } };
    },
  };
  await withServer({ cbcapReviewAPI }, async (base) => {
    const response = await fetch(`${base}/api/cbcap/runs/run-1/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'approved_output');
    assert.equal(seenContext, true);

    const health = await fetch(`${base}/api/health`).then((item) => item.json());
    assert.equal(health.reviewContinuationEnabled, true);
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
    assert.match(allowed.headers.get('access-control-allow-headers'), /Authorization/);

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
  const memory = new Map();
  const sessionStore = {
    create(input) {
      const session = { id: 'session-1', location: input.location || null };
      memory.set(session.id, session);
      return session;
    },
    get(id) {
      return memory.get(id) || null;
    },
    update(id, patch) {
      const current = memory.get(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      memory.set(id, next);
      return next;
    },
  };
  await withServer({ enableLegacySessions: true, sessionStore }, async (base) => {
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

test('health endpoint identifies governed runtime and disabled optional boundaries', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/api/health`);
    const body = await response.json();
    assert.equal(body.version, '0.7.0');
    assert.equal(body.runtime, 'governed-graph');
    assert.equal(body.legacySessionsEnabled, false);
    assert.equal(body.reviewContinuationEnabled, false);
  });
});
