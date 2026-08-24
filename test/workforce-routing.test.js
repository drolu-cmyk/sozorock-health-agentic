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

test('workforce capacity route is absent without institutional gateway, including development planning override', async () => {
  for (const options of [{}, { allowUnauthenticatedDevCBCAP: true }]) {
    await withServer(options, async (base) => {
      const response = await fetch(`${base}/api/cbcap/workforce/capacity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countyFips: '36001' }),
      });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const health = await fetch(`${base}/api/health`).then((item) => item.json());
      assert.equal(health.workforceCapacityRouteEnabled, false);
    });
  }
});

test('institutional gateway exclusively owns workforce capacity route', async () => {
  const seen = [];
  const gateway = {
    async handlePlan() { return { statusCode: 202, body: {} }; },
    async handleReview() { return { statusCode: 200, body: {} }; },
    async handleWorkforce(body, context) {
      seen.push({ body, hasRequest: Boolean(context.request) });
      return {
        statusCode: 200,
        body: {
          contract: 'cbcap.workforce-capacity.v1',
          countyFips: body.countyFips,
          evidenceState: 'no_verified_data',
          compositeScore: null,
          countyRank: null,
          shortageVerdict: null,
        },
      };
    },
  };

  await withServer({ institutionalCBCAPGateway: gateway }, async (base) => {
    const response = await fetch(`${base}/api/cbcap/workforce/capacity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ countyFips: '36001' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.contract, 'cbcap.workforce-capacity.v1');
    assert.equal(body.shortageVerdict, null);
    assert.deepEqual(seen, [{ body: { countyFips: '36001' }, hasRequest: true }]);
    const health = await fetch(`${base}/api/health`).then((item) => item.json());
    assert.equal(health.workforceCapacityRouteEnabled, true);
  });
});
