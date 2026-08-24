const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { createInstitutionalCBCAPGateway } = require('../server/institutional-cbcap-gateway');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'principal-1',
    actorType: 'human',
    role: 'research_funder_viewer',
    access: 'viewer',
    displayName: 'Viewer One',
    ...overrides,
  };
}

async function withServer(options, fn) {
  const app = createApp({
    allowedOrigins: new Set(['https://cbcap.sozorockfoundation.org']),
    placeAPI: { async handle() { return { statusCode: 200, body: { status: 'ok' } }; } },
    ...options,
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('institutional gateway routes visualization planning after identity and permission checks', async () => {
  let runtimeCalls = 0;
  let apiCalls = 0;
  const gateway = createInstitutionalCBCAPGateway({
    identityResolver: async () => actor(),
    runtimeForActor: async (workspaceActor) => {
      runtimeCalls += 1;
      assert.equal(workspaceActor.tenantId, 'tenant-a');
      return {
        visualizationApi: {
          async handle(input, context) {
            apiCalls += 1;
            assert.equal(context.workspaceActor.principalId, 'principal-1');
            return { statusCode: 200, body: { question: input.question, artifactFamily: 'funding_criteria_matrix' } };
          },
        },
      };
    },
  });
  const result = await gateway.handleVisualization({ question: 'funding_fit' }, { request: { headers: {} } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.artifactFamily, 'funding_criteria_matrix');
  assert.equal(runtimeCalls, 1);
  assert.equal(apiCalls, 1);
});

test('invalid identity fails before tenant runtime selection', async () => {
  let runtimeCalls = 0;
  const gateway = createInstitutionalCBCAPGateway({
    identityResolver: async () => { throw new Error('bad token'); },
    runtimeForActor: async () => { runtimeCalls += 1; return {}; },
  });
  const result = await gateway.handleVisualization({ question: 'planning_alignment' }, { request: {} });
  assert.equal(result.statusCode, 403);
  assert.equal(runtimeCalls, 0);
});

test('HTTP visualization route is hidden without institutional gateway and no dev bypass exposes it', async () => {
  await withServer({ allowUnauthenticatedDevCBCAP: true, cbcapAPI: { async handle() { return { statusCode: 202, body: {} }; } } }, async (base) => {
    const response = await fetch(`${base}/api/cbcap/visualizations/spec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'planning_alignment' }),
    });
    assert.equal(response.status, 404);
  });
});

test('HTTP visualization route uses institutional gateway and remains no-store', async () => {
  const institutionalCBCAPGateway = {
    async handlePlan() { return { statusCode: 202, body: {} }; },
    async handleReview() { return { statusCode: 200, body: {} }; },
    async handleVisualization(input) {
      return { statusCode: 200, body: { question: input.question, artifactFamily: 'evidence_alignment_matrix' } };
    },
  };
  await withServer({ institutionalCBCAPGateway }, async (base) => {
    const response = await fetch(`${base}/api/cbcap/visualizations/spec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ question: 'planning_alignment' }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.artifactFamily, 'evidence_alignment_matrix');
  });
});
