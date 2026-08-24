const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EvidenceGatewayClient,
  packageHash,
} = require('../packages/adapters/evidence-gateway-client');

function response(overrides = {}) {
  const releaseId = overrides.releaseId || 'release-1';
  const countyFips = overrides.countyFips || '36001';
  const packageData = {
    contract_version: 'sozorock.evidence-gateway.v1',
    release_id: releaseId,
    geographies: overrides.geographies || [{ id: `county:${countyFips}`, kind: 'county', county_fips: countyFips }],
    source_versions: [{ source_version_id: 'places-2025', review_status: 'verified' }],
    metric_semantics: [{ id: 'diabetes' }],
    measures: [{ id: 'diabetes', value: 9.4 }],
    source_coverage: [],
    ...(overrides.package || {}),
  };
  const releaseHash = overrides.releaseHash || packageHash(packageData);
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
        package: packageData,
      };
    },
  };
}

test('Evidence Gateway client preserves governed release identity and verifies package hash', async () => {
  const supplied = response();
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => supplied,
  });
  const result = await client.getCountyPackage('36001');
  assert.equal(result.contract, 'sozorock.evidence-gateway.v1');
  assert.equal(result.releaseId, 'release-1');
  assert.equal(result.releaseHash, supplied.headers.get('x-evidence-release-hash'));
  assert.equal(result.countyFips, '36001');
});

test('Evidence Gateway client fails closed on county mismatch', async () => {
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => response({ countyFips: '36093' }),
  });
  await assert.rejects(() => client.getCountyPackage('36001'), /does not match requested county/);
});

test('Evidence Gateway client fails closed on multiple geographies', async () => {
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => response({
      geographies: [
        { id: 'county:36001', kind: 'county', county_fips: '36001' },
        { id: 'county:36093', kind: 'county', county_fips: '36093' },
      ],
    }),
  });
  await assert.rejects(() => client.getCountyPackage('36001'), /exactly one geography/);
});

test('Evidence Gateway client fails closed on non-county geography', async () => {
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => response({ geographies: [{ id: 'zcta:12207', kind: 'zcta', county_fips: '36001' }] }),
  });
  await assert.rejects(() => client.getCountyPackage('36001'), /must contain a county geography/);
});

test('Evidence Gateway client fails closed on release-header mismatch', async () => {
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => response({ headerReleaseHash: `sha256:${'c'.repeat(64)}` }),
  });
  await assert.rejects(() => client.getCountyPackage('36001'), /release hash header does not match/);
});

test('Evidence Gateway client fails closed when package bytes do not match the manifest hash', async () => {
  const supplied = response();
  const originalJson = supplied.json.bind(supplied);
  supplied.json = async () => {
    const body = await originalJson();
    body.package.measures[0].value = 99;
    return body;
  };
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => supplied,
  });
  await assert.rejects(() => client.getCountyPackage('36001'), /package SHA256/);
});

test('Evidence Gateway client accepts a complete governed planning extension', async () => {
  const supplied = response({
    package: {
      planning_contract_version: 'sozorock.evidence-gateway.planning.v1',
      planning_documents: [],
      planning_claims: [],
      planning_citations: [],
    },
  });
  const client = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => supplied,
  });
  const result = await client.getCountyPackage('36001');
  assert.equal(result.package.planning_contract_version, 'sozorock.evidence-gateway.planning.v1');
});

test('Evidence Gateway client rejects incomplete or unknown planning extensions', async () => {
  const incomplete = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => response({ package: { planning_documents: [] } }),
  });
  await assert.rejects(() => incomplete.getCountyPackage('36001'), /planning extension is incomplete/);

  const unknown = new EvidenceGatewayClient({
    baseUrl: 'https://health.sozorockfoundation.org',
    fetchImpl: async () => response({
      package: {
        planning_contract_version: 'unknown.planning.v9',
        planning_documents: [],
        planning_claims: [],
        planning_citations: [],
      },
    }),
  });
  await assert.rejects(() => unknown.getCountyPackage('36001'), /Unsupported Evidence Gateway planning contract/);
});
