const test = require('node:test');
const assert = require('node:assert/strict');
const { tenantEvidencePartition } = require('../packages/runtime/tenant-private-evidence');
const { createS3PrivateEvidenceObjectResolver } = require('../server/s3-private-evidence-object-resolver');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'planner-a',
    actorType: 'human',
    role: 'county_planner',
    access: 'owner',
    displayName: 'Planner A',
    ...overrides,
  };
}

function clientFor(responses) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push({ name: command.constructor.name, input: command.input });
      const handler = responses[command.constructor.name];
      if (!handler) throw new Error(`Unexpected command ${command.constructor.name}`);
      return typeof handler === 'function' ? handler(command.input) : handler;
    },
  };
}

const bucket = 'cbcap-private-evidence-prod';
const kmsKeyArn = 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012';

function cleanHead(overrides = {}) {
  return {
    VersionId: 'version-1',
    ContentLength: 2048,
    ContentType: 'application/pdf',
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: kmsKeyArn,
    Metadata: {
      'content-sha256': 'a'.repeat(64),
      'security-scan-status': 'clean',
    },
    ...overrides,
  };
}

test('S3 resolver binds object lookup to the authenticated tenant partition', async () => {
  const expectedPrefix = `tenant-evidence/${tenantEvidencePartition('tenant-a')}/upload-1/`;
  const client = clientFor({
    ListObjectsV2Command: ({ Prefix }) => ({ Contents: [{ Key: `${Prefix}evidence.pdf` }], IsTruncated: false }),
    HeadObjectCommand: cleanHead(),
  });
  const resolve = createS3PrivateEvidenceObjectResolver({ region: 'us-east-1', bucket, kmsKeyArn, client });

  const result = await resolve(actor(), 'upload-1');
  assert.equal(client.calls[0].input.Prefix, expectedPrefix);
  assert.equal(client.calls[0].input.MaxKeys, 2);
  assert.equal(result.key, `${expectedPrefix}evidence.pdf`);
  assert.equal(result.contentHash, `sha256:${'a'.repeat(64)}`);
  assert.equal(result.securityScanStatus, 'clean');
  assert.equal(result.publicAccessBlocked, true);
});

test('S3 resolver returns null for an unknown tenant upload', async () => {
  const client = clientFor({ ListObjectsV2Command: { Contents: [], IsTruncated: false } });
  const resolve = createS3PrivateEvidenceObjectResolver({ region: 'us-east-1', bucket, kmsKeyArn, client });
  assert.equal(await resolve(actor(), 'missing-upload'), null);
  assert.equal(client.calls.length, 1);
});

test('S3 resolver fails closed on ambiguous upload prefixes', async () => {
  const client = clientFor({
    ListObjectsV2Command: ({ Prefix }) => ({
      Contents: [{ Key: `${Prefix}a.pdf` }, { Key: `${Prefix}b.pdf` }],
      IsTruncated: false,
    }),
  });
  const resolve = createS3PrivateEvidenceObjectResolver({ region: 'us-east-1', bucket, kmsKeyArn, client });
  await assert.rejects(() => resolve(actor(), 'upload-1'), /ambiguous object set/i);
});

test('S3 resolver rejects wrong KMS keys and missing immutable content hashes', async () => {
  const prefix = `tenant-evidence/${tenantEvidencePartition('tenant-a')}/upload-1/`;
  const wrongKeyClient = clientFor({
    ListObjectsV2Command: { Contents: [{ Key: `${prefix}evidence.pdf` }], IsTruncated: false },
    HeadObjectCommand: cleanHead({ SSEKMSKeyId: 'arn:aws:kms:us-east-1:123456789012:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
  });
  const wrongKeyResolver = createS3PrivateEvidenceObjectResolver({ region: 'us-east-1', bucket, kmsKeyArn, client: wrongKeyClient });
  await assert.rejects(() => wrongKeyResolver(actor(), 'upload-1'), /approved KMS key/i);

  const noHashClient = clientFor({
    ListObjectsV2Command: { Contents: [{ Key: `${prefix}evidence.pdf` }], IsTruncated: false },
    HeadObjectCommand: cleanHead({ Metadata: { 'security-scan-status': 'clean' } }),
  });
  const noHashResolver = createS3PrivateEvidenceObjectResolver({ region: 'us-east-1', bucket, kmsKeyArn, client: noHashClient });
  await assert.rejects(() => noHashResolver(actor(), 'upload-1'), /content SHA-256/i);
});

test('S3 resolver rejects path-shaped upload identifiers before touching storage', async () => {
  const client = clientFor({});
  const resolve = createS3PrivateEvidenceObjectResolver({ region: 'us-east-1', bucket, kmsKeyArn, client });
  await assert.rejects(() => resolve(actor(), '../other-tenant'), /unsupported characters/i);
  assert.equal(client.calls.length, 0);
});
