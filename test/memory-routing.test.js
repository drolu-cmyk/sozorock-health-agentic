const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');

async function withServer(options, fn) {
  const app = createApp({ allowedOrigins: new Set(['https://cbcap.sozorockfoundation.org']), placeAPI: { async handle() { return { statusCode: 200, body: {} }; } }, ...options });
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const json = { 'Content-Type': 'application/json', Authorization: 'Bearer token' };

test('workspace and institutional memory routes are absent without institutional gateway, including dev planning mode', async () => {
  await withServer({ allowUnauthenticatedDevCBCAP: true, cbcapAPI: { async handle() { return { statusCode: 202, body: {} }; } } }, async (base) => {
    for (const [url, method, body] of [
      [`${base}/api/cbcap/workspaces/w1/items`, 'GET', null],
      [`${base}/api/cbcap/workspaces/w1/items`, 'POST', { itemType: 'task', content: {} }],
      [`${base}/api/cbcap/memory/query`, 'POST', {}],
      [`${base}/api/cbcap/memory/proposals`, 'POST', {}],
    ]) {
      const response = await fetch(url, { method, headers: json, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, 404);
    }
  });
});

test('institutional gateway owns workspace and memory HTTP routes', async () => {
  const calls = [];
  const gateway = {
    async handlePlan() { return { statusCode: 202, body: {} }; },
    async handleReview() { return { statusCode: 200, body: {} }; },
    async handleWorkspaceList(workspaceId, input) { calls.push(['list', workspaceId, input]); return { statusCode: 200, body: { items: [] } }; },
    async handleWorkspaceCreate(input) { calls.push(['create', input]); return { statusCode: 201, body: { id: 'item-1', ...input } }; },
    async handleWorkspaceUpdate(workspaceId, itemId, input) { calls.push(['update', workspaceId, itemId, input]); return { statusCode: 200, body: { id: itemId } }; },
    async handleMemoryQuery(input) { calls.push(['query', input]); return { statusCode: 200, body: { records: [] } }; },
    async handleMemoryPropose(input) { calls.push(['propose', input]); return { statusCode: 201, body: { id: 'proposal-1' } }; },
    async handleMemoryReview(id, input) { calls.push(['review', id, input]); return { statusCode: 200, body: { id: 'review-1' } }; },
    async handleMemorySupersede(id, input) { calls.push(['supersede', id, input]); return { statusCode: 200, body: { id: 'supersede-1' } }; },
  };
  await withServer({ institutionalCBCAPGateway: gateway }, async (base) => {
    assert.equal((await fetch(`${base}/api/cbcap/workspaces/w1/items`, { headers: json })).status, 200);
    assert.equal((await fetch(`${base}/api/cbcap/workspaces/w1/items`, { method: 'POST', headers: json, body: JSON.stringify({ itemType: 'task', content: {} }) })).status, 201);
    assert.equal((await fetch(`${base}/api/cbcap/workspaces/w1/items/item-1`, { method: 'PUT', headers: json, body: JSON.stringify({ expectedVersion: 1, patch: { status: 'done' } }) })).status, 200);
    assert.equal((await fetch(`${base}/api/cbcap/memory/query`, { method: 'POST', headers: json, body: '{}' })).status, 200);
    assert.equal((await fetch(`${base}/api/cbcap/memory/proposals`, { method: 'POST', headers: json, body: '{}' })).status, 201);
    assert.equal((await fetch(`${base}/api/cbcap/memory/proposals/proposal-1/review`, { method: 'POST', headers: json, body: JSON.stringify({ decision: 'approve' }) })).status, 200);
    assert.equal((await fetch(`${base}/api/cbcap/memory/memory-1/supersede`, { method: 'POST', headers: json, body: '{}' })).status, 200);
    assert.equal(calls.length, 7);
    const health = await fetch(`${base}/api/health`).then((item) => item.json());
    assert.equal(health.workspaceMemoryRouteEnabled, true);
    assert.equal(health.institutionalMemoryRouteEnabled, true);
  });
});
