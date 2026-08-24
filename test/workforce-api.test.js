const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPWorkforceApi } = require('../server/cbcap-workforce-api');

const RELEASE_HASH = `sha256:${'a'.repeat(64)}`;

function actor() {
  return {
    tenantId: 'tenant-a',
    principalId: 'agent-1',
    actorType: 'agent',
    role: 'evidence_agent',
    access: 'viewer',
    displayName: 'Evidence Agent',
  };
}

function evidence() {
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'release-1',
    releaseHash: RELEASE_HASH,
    countyFips: '36001',
    package: {
      measures: [],
      source_coverage: [
        { id: 'pc', source_id: 'hrsa-workforce', coverage_key: 'hpsa:primary_care', status: 'complete_no_records', review_status: 'verified' },
        { id: 'dental', source_id: 'hrsa-workforce', coverage_key: 'hpsa:dental', status: 'complete_no_records', review_status: 'verified' },
        { id: 'mental', source_id: 'hrsa-workforce', coverage_key: 'hpsa:mental_health', status: 'complete_no_records', review_status: 'verified' },
      ],
    },
  };
}

test('workforce API accepts county identity only and rejects client supplied evidence or scoring fields', async () => {
  let calls = 0;
  const api = createCBCAPWorkforceApi({
    evidenceClient: {
      async getCountyPackage() { calls += 1; return evidence(); },
    },
  });

  for (const extra of [
    { measures: [] },
    { workforceScore: 92 },
    { sourceCoverage: [] },
    { shortageVerdict: 'severe' },
  ]) {
    const result = await api.handle({ countyFips: '36001', ...extra }, { workspaceActor: actor() });
    assert.equal(result.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('workforce API loads the exact county package from the governed server-side evidence client', async () => {
  const seen = [];
  const api = createCBCAPWorkforceApi({
    evidenceClient: {
      async getCountyPackage(countyFips) {
        seen.push(countyFips);
        return evidence();
      },
    },
  });

  const result = await api.handle({ countyFips: '36001' }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(seen, ['36001']);
  assert.equal(result.body.contract, 'cbcap.workforce-capacity.v1');
  assert.equal(result.body.hpsaCoverage.noDesignationsReported, true);
  assert.equal(result.body.shortageVerdict, null);
});

test('workforce API rejects invalid geography before evidence access', async () => {
  let called = false;
  const api = createCBCAPWorkforceApi({
    evidenceClient: {
      async getCountyPackage() { called = true; return evidence(); },
    },
  });
  const result = await api.handle({ countyFips: 'Albany' }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 400);
  assert.equal(called, false);
});

test('workforce API sanitizes governed evidence failures', async () => {
  const api = createCBCAPWorkforceApi({
    evidenceClient: {
      async getCountyPackage() { throw new Error('database secret detail'); },
    },
  });
  const result = await api.handle({ countyFips: '36001' }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error, 'Governed workforce evidence is temporarily unavailable.');
  assert.equal(JSON.stringify(result.body).includes('database secret detail'), false);
});
