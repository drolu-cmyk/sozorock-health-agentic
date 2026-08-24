const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');

async function withServer(options, fn) {
  const app = createApp({
    allowedOrigins: new Set(['https://cbcap.sozorockfoundation.org']),
    placeAPI: { async handle() { return { statusCode: 200, body: { status: 'ok' } }; } },
    cbcapAPI: { async handle() { return { statusCode: 202, body: { status: 'awaiting_human_review' } }; } },
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

test('monitoring route is absent without institutional gateway, including development planning override', async () => {
  for (const allowUnauthenticatedDevCBCAP of [false, true]) {
    await withServer({ allowUnauthenticatedDevCBCAP }, async (base) => {
      const response = await fetch(`${base}/api/cbcap/monitoring/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorId: 'monitor-1' }),
      });
      assert.equal(response.status, 404);
      const health = await fetch(`${base}/api/health`).then((item) => item.json());
      assert.equal(health.monitoringIntelligenceRouteEnabled, false);
    });
  }
});

test('institutional gateway owns monitoring route and receives request context', async () => {
  let calls = 0;
  const institutionalCBCAPGateway = {
    async handlePlan() { return { statusCode: 202, body: { status: 'awaiting_human_review' } }; },
    async handleReview() { return { statusCode: 200, body: { status: 'approved_output' } }; },
    async handleMonitoring(body, context) {
      calls += 1;
      assert.deepEqual(body, { monitorId: 'monitor-1', asOf: '2026-08-23' });
      assert.ok(context.request);
      return { statusCode: 200, body: { contract: 'cbcap.monitoring.v1', monitorId: 'monitor-1', status: 'no_change' } };
    },
  };

  await withServer({ institutionalCBCAPGateway }, async (base) => {
    const response = await fetch(`${base}/api/cbcap/monitoring/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ monitorId: 'monitor-1', asOf: '2026-08-23' }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    const body = await response.json();
    assert.equal(body.contract, 'cbcap.monitoring.v1');
    const health = await fetch(`${base}/api/health`).then((item) => item.json());
    assert.equal(health.monitoringIntelligenceRouteEnabled, true);
  });
});
