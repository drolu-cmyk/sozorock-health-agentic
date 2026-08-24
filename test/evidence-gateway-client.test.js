const test = require('node:test');
const assert = require('node:assert/strict');
const { EvidenceGatewayClient } = require('../packages/adapters/evidence-gateway-client');

const HASH = `sha256:${'b'.repeat(64)}`;

function response(overrides = {}) {
  const releaseId = overrides.releaseId || 'release-1';
  const releaseHash = overrides.releaseHash || HASH;
  const countyFips = overrides.countyFips || '36001';
  const headers = new Headers({
    'x-evidence-contract': overrides.headerContract || 'sozorock.evidence-gateway.v1',
    'x-evidence-release': overrides.headerReleaseId || releaseId,
    'x-evidence-release-hash': overrides.headerReleaseHash || releaseHash,
  });
  return {
    ok: true,
    status: 200,
    headers,
    async json() {
      return {
        manifest: {
          contract_version: 'sozorock.evidence-gateway.v1',
          release_id: releaseId,
          release_hash: releaseHash,
        },
        package: {
          contract_version: 'sozorock.evidence-gateway.v1',
          release_id: releaseId,
          geographies: [{ kind: 'county', county_fips: countyFips }],
          source_versions: [{ id: 'places-2025' }],
          metric_semantics: [{ id: 'diabetes' }],
          measures: [{ id: 'diabetes', value: 9.4 }],
          source_coverage: [],
        },
      };
    },
  };
}

test('Evidence Gateway client preserves governed release identity', async () => {
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => response(),
  });
  const result = await client.getCountyPackage('36001');
  assert.equal(result.contract, 'sozorock.evidence-gateway.v1');
  assert.equal(result.releaseId, 'release-1');
  assert.equal(result.releaseHash, HASH);
  assert.equal(result.countyFips, '36001');
});

test('Evidence Gateway client fails closed on county mismatch', async () => {
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => response({ countyFips: '36093' }),
  });
  await assert.rejects(() => client.getCountyPackage('36001'), /does not match requested county/);
});

test('Evidence Gateway client fails closed on release-header mismatch', async () => {
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => response({ headerReleaseHash: `sha256:${'c'.repeat(64)}` }),
  });
  await assert.rejects(() => client.getCountyPackage('36001'), /release hash header does not match/);
});
