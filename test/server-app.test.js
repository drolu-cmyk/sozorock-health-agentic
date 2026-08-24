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

test('institutional CB-CAP, review, and funding endpoints fail closed by default', async () => {
  await withServer({}, async (base) => {
    const plan = await fetch(`${base}/api/cbcap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: '36001' }),
    });
    assert.equal(plan.status, 404);
    assert.equal(plan.headers.get('cache-control'), 'no-store');

    const review = await fetch(`${base}/api/cbcap/runs/run-1/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(review.status, 404);

    const funding = await fetch(`${base}/api/cbcap/funding/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opportunityId: 'opp-1', countyId: 'county:36001' }),
    });
    assert.equal(funding.status, 404);
  });
});

test('unknown API paths never fall through to the frontend SPA', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/api/not-a-real-route`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    assert.doesNotMatch(text, /<!doctype html>/i);
  });
});

test('unauthenticated CB-CAP is available only through explicit development override and does not enable funding', async () => {
  await withServer({ allowUnauthenticatedDevCBCAP: true }, async (base) => {
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

    const funding = await fetch(`${base}/api/cbcap/funding/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opportunityId: 'opp-1', countyId: 'county:36001' }),
    });
    assert.equal(funding.status, 404);

    const health = await fetch(`${base}/api/health`).then((item) => item.json());
    assert.equal(health.unauthenticatedDevCBCAPEnabled, true);
    assert.equal(health.institutionalAccessEnabled, false);
    assert.equal(health.fundingIntelligenceRouteEnabled, false);
    assert.equal(health.workspaceMemoryRouteEnabled, false);
    assert.equal(health.institutionalMemoryRouteEnabled, false);
  });
});

test('institutional gateway owns planning, review, and funding routes', async () => {
  const calls = { plan: 0, review: 0, funding: 0, requestContexts: 0 };
  const institutionalCBCAPGateway = {
    async handlePlan(body, context) {
      calls.plan += 1;
      if (context?.request) calls.requestContexts += 1;
      assert.deepEqual(body, { location: '36001' });
      return { statusCode: 202, body: { status: 'awaiting_human_review', runId: 'run-1' } };
    },
    async handleReview(runId, body, context) {
      calls.review += 1;
      if (context?.request) calls.requestContexts += 1;
      assert.equal(runId, 'run-1');
      assert.deepEqual(body, { decision: 'approve' });
      return { statusCode: 200, body: { status: 'approved_output', runId } };
    },
    async handleFunding(body, context) {
      calls.funding += 1;
      if (context?.request) calls.requestContexts += 1;
      assert.deepEqual(body, { opportunityId: 'opp-1', countyId: 'county:36001' });
      return { statusCode: 200, body: { status: 'provisional_review_required', opportunityId: 'opp-1' } };
    },
  };

  await withServer({ institutionalCBCAPGateway }, async (base) => {
    const plan = await fetch(`${base}/api/cbcap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ location: '36001' }),
    });
    assert.equal(plan.status, 202);

    const review = await fetch(`${base}/api/cbcap/runs/run-1/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(review.status, 200);

    const funding = await fetch(`${base}/api/cbcap/funding/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ opportunityId: 'opp-1', countyId: 'county:36001' }),
    });
    assert.equal(funding.status, 200);
    assert.equal(calls.plan, 1);
    assert.equal(calls.review, 1);
    assert.equal(calls.funding, 1);
    assert.equal(calls.requestContexts, 3);

    const health = await fetch(`${base}/api/health`).then((item) => item.json());
    assert.equal(health.institutionalAccessEnabled, true);
    assert.equal(health.reviewContinuationEnabled, true);
    assert.equal(health.fundingIntelligenceRouteEnabled, true);
    assert.equal(health.unauthenticatedDevCBCAPEnabled, false);
  });
});

test('institutional gateway without funding handler keeps funding route hidden', async () => {
  const institutionalCBCAPGateway = {
    async handlePlan() { return { statusCode: 202, body: { status: 'awaiting_human_review' } }; },
    async handleReview() { return { statusCode: 200, body: { status: 'approved_output' } }; },
  };
  await withServer({ institutionalCBCAPGateway }, async (base) => {
    const funding = await fetch(`${base}/api/cbcap/funding/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ opportunityId: 'opp-1', countyId: 'county:36001' }),
    });
    assert.equal(funding.status, 404);
    const health = await fetch(`${base}/api/health`).then((item) => item.json());
    assert.equal(health.fundingIntelligenceRouteEnabled, false);
  });
});

test('public audit and legacy session endpoints remain closed by default', async () => {
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

test('health endpoint identifies identity-gated runtime and disabled optional boundaries', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/api/health`);
    const body = await response.json();
    assert.equal(body.version, '0.10.0');
    assert.equal(body.runtime, 'governed-graph');
    assert.equal(body.institutionalAccessEnabled, false);
    assert.equal(body.reviewContinuationEnabled, false);
    assert.equal(body.fundingIntelligenceRouteEnabled, false);
    assert.equal(body.visualizationIntelligenceRouteEnabled, false);
    assert.equal(body.workspaceMemoryRouteEnabled, false);
    assert.equal(body.institutionalMemoryRouteEnabled, false);
    assert.equal(body.unauthenticatedDevCBCAPEnabled, false);
    assert.equal(body.legacySessionsEnabled, false);
  });
});
