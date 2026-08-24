const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPPrivateEvidenceApi } = require('../server/cbcap-private-evidence-api');
const { InMemoryTenantPrivateEvidenceStore, tenantEvidencePartition } = require('../packages/runtime/tenant-private-evidence');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'planner-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner',
    ...overrides,
  };
}

function object() {
  return {
    uploadId: 'upload-1',
    bucket: 'cbcap-private-evidence-prod',
    key: `tenant-evidence/${tenantEvidencePartition('tenant-a')}/upload-1/evidence.pdf`,
    versionId: 'v1',
    contentHash: `sha256:${'b'.repeat(64)}`,
    byteLength: 1000,
    mediaType: 'application/pdf',
    encryptionMode: 'aws:kms',
    kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012',
    publicAccessBlocked: true,
    securityScanStatus: 'clean',
  };
}

function submission() {
  return {
    uploadId: 'upload-1',
    geographyIds: ['county:36001'],
    submittedInRunId: 'run-1',
    documentType: 'local_plan',
    sourceLabel: 'Tenant local plan',
    sensitivity: 'confidential',
    rightsBasis: 'organization_owned',
    usageRightsConfirmed: true,
    aggregationLevel: 'organizational',
    containsPhi: false,
    containsIndividualHealthRecords: false,
    containsCredentialsOrSecrets: false,
    retentionUntil: '2027-12-31',
  };
}

function api() {
  const store = new InMemoryTenantPrivateEvidenceStore({ tenantId: 'tenant-a' });
  let objectCalls = 0;
  const service = createCBCAPPrivateEvidenceApi({
    async objectForActor(resolvedActor, uploadId) {
      objectCalls += 1;
      assert.equal(resolvedActor.tenantId, 'tenant-a');
      assert.equal(uploadId, 'upload-1');
      return object();
    },
    async storeForActor(resolvedActor) {
      assert.equal(resolvedActor.tenantId, 'tenant-a');
      return store;
    },
    clock: (() => {
      let tick = 0;
      return () => `2026-08-24T${String(12 + tick++).padStart(2, '0')}:00:00.000Z`;
    })(),
  });
  return { service, store, objectCalls: () => objectCalls };
}

test('submission resolves storage metadata server-side and rejects client-supplied storage fields', async () => {
  const state = api();
  const blocked = await state.service.submit({ ...submission(), bucket: 'attacker-bucket' }, { workspaceActor: actor() });
  assert.equal(blocked.statusCode, 400);
  assert.equal(state.objectCalls(), 0);

  const result = await state.service.submit(submission(), { workspaceActor: actor() });
  assert.equal(result.statusCode, 201);
  assert.equal(state.objectCalls(), 1);
  assert.equal(result.body.publicEvidence, false);
  assert.equal(result.body.storageLocationExposed, false);
  assert.equal(JSON.stringify(result.body).includes('cbcap-private-evidence-prod'), false);
});

test('unreviewed private evidence is not returned as usable evidence', async () => {
  const state = api();
  await state.service.submit(submission(), { workspaceActor: actor() });
  const result = await state.service.query({ geographyId: 'county:36001' }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.documents, []);
  assert.equal(result.body.blockedDocumentIds.length, 1);
  assert.equal(result.body.publicEvidenceModified, false);
  assert.equal(result.body.institutionalTruthPromoted, false);
});

test('accepted human review makes sanitized evidence available to the same tenant only', async () => {
  const state = api();
  const submitted = await state.service.submit(submission(), { workspaceActor: actor() });
  const reviewed = await state.service.review(submitted.body.documentId, {
    decision: 'accepted',
    reasonCodes: ['reviewed_rights_and_scope'],
    rationale: 'Accepted for tenant-only planning use.',
  }, { workspaceActor: actor() });
  assert.equal(reviewed.statusCode, 201);
  assert.equal(reviewed.body.latestReview.decision, 'accepted');

  const result = await state.service.query({ geographyId: 'county:36001' }, { workspaceActor: actor() });
  assert.equal(result.body.documents.length, 1);
  assert.equal(result.body.documents[0].documentId, submitted.body.documentId);
  assert.equal(result.body.documents[0].publicEvidence, false);
  assert.equal(result.body.documents[0].institutionalTruth, false);
});

test('query requires a bounded geography and cannot enumerate an entire tenant evidence catalog', async () => {
  const state = api();
  const result = await state.service.query({}, { workspaceActor: actor() });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /geographyId is required/i);
});

test('private evidence API fails closed when tenant store is unavailable', async () => {
  const service = createCBCAPPrivateEvidenceApi({
    async objectForActor() { return object(); },
    async storeForActor() { throw new Error('database down'); },
  });
  const result = await service.submit(submission(), { workspaceActor: actor() });
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.stringify(result.body).includes('database down'), false);
});
