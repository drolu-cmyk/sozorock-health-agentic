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

test('tenant-private evidence routes are absent without institutional gateway, including development override', async () => {
  for (const options of [{}, { allowUnauthenticatedDevCBCAP: true }]) {
    await withServer(options, async (base) => {
      for (const path of [
        '/api/cbcap/private-evidence/submissions',
        '/api/cbcap/private-evidence/document-1/review',
        '/api/cbcap/private-evidence/query',
      ]) {
        const response = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        assert.equal(response.status, 404);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      const health = await fetch(`${base}/api/health`).then((item) => item.json());
      assert.equal(health.privateEvidenceRouteEnabled, false);
    });
  }
});

test('institutional gateway exclusively owns all private evidence routes', async () => {
  const calls = [];
  const gateway = {
    async handlePlan() { return { statusCode: 202, body: {} }; },
    async handleReview() { return { statusCode: 200, body: {} }; },
    async handlePrivateEvidenceSubmit(body, context) {
      calls.push(['submit', body.uploadId, Boolean(context.request)]);
      return { statusCode: 201, body: { documentId: 'doc-1' } };
    },
    async handlePrivateEvidenceReview(documentId, body, context) {
      calls.push(['review', documentId, body.decision, Boolean(context.request)]);
      return { statusCode: 201, body: { documentId, decision: body.decision } };
    },
    async handlePrivateEvidenceQuery(body, context) {
      calls.push(['query', body.geographyId, Boolean(context.request)]);
      return { statusCode: 200, body: { documents: [] } };
    },
  };

  await withServer({ institutionalCBCAPGateway: gateway }, async (base) => {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer token' };
    assert.equal((await fetch(`${base}/api/cbcap/private-evidence/submissions`, { method: 'POST', headers, body: JSON.stringify({ uploadId: 'upload-1' }) })).status, 201);
    assert.equal((await fetch(`${base}/api/cbcap/private-evidence/doc-1/review`, { method: 'POST', headers, body: JSON.stringify({ decision: 'accepted' }) })).status, 201);
    assert.equal((await fetch(`${base}/api/cbcap/private-evidence/query`, { method: 'POST', headers, body: JSON.stringify({ geographyId: 'county:36001' }) })).status, 200);
    const health = await fetch(`${base}/api/health`).then((item) => item.json());
    assert.equal(health.privateEvidenceRouteEnabled, true);
  });

  assert.deepEqual(calls, [
    ['submit', 'upload-1', true],
    ['review', 'doc-1', 'accepted', true],
    ['query', 'county:36001', true],
  ]);
});
