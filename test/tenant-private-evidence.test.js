const test = require('node:test');
const assert = require('node:assert/strict');
const {
  InMemoryTenantPrivateEvidenceStore,
  authorizeUse,
  normalizeReview,
  normalizeSubmission,
  sanitizeDocument,
  tenantEvidencePartition,
} = require('../packages/runtime/tenant-private-evidence');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'planner-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'County Planner',
    ...overrides,
  };
}

function storedObject(overrides = {}) {
  return {
    uploadId: 'upload-1',
    bucket: 'cbcap-private-evidence-prod',
    key: `tenant-evidence/${tenantEvidencePartition('tenant-a')}/upload-1/evidence.pdf`,
    versionId: 'version-1',
    contentHash: `sha256:${'a'.repeat(64)}`,
    byteLength: 2048,
    mediaType: 'application/pdf',
    encryptionMode: 'aws:kms',
    kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012',
    publicAccessBlocked: true,
    securityScanStatus: 'clean',
    ...overrides,
  };
}

function submission(overrides = {}) {
  return {
    uploadId: 'upload-1',
    geographyIds: ['county:36001'],
    submittedInRunId: 'run-1',
    documentType: 'implementation_plan',
    sourceLabel: 'Internal implementation plan',
    sensitivity: 'confidential',
    rightsBasis: 'organization_owned',
    usageRightsConfirmed: true,
    aggregationLevel: 'organizational',
    containsPhi: false,
    containsIndividualHealthRecords: false,
    containsCredentialsOrSecrets: false,
    retentionUntil: '2027-12-31',
    ...overrides,
  };
}

test('eligible tenant evidence is bound to authenticated tenant storage partition and human actor', () => {
  const document = normalizeSubmission(submission(), actor(), storedObject(), '2026-08-24T12:00:00.000Z');
  assert.equal(document.tenantId, 'tenant-a');
  assert.equal(document.admissionState, 'eligible_for_review');
  assert.deepEqual(document.reasonCodes, []);
  assert.match(document.id, /^tenant-evidence:sha256:[0-9a-f]{64}$/);
});

test('wrong tenant partition, public storage, or non-KMS storage fails closed', () => {
  assert.throws(() => normalizeSubmission(submission(), actor(), storedObject({ key: 'tenant-evidence/wrong/upload-1/evidence.pdf' })), /tenant partition/i);
  assert.throws(() => normalizeSubmission(submission(), actor(), storedObject({ publicAccessBlocked: false })), /block public access/i);
  assert.throws(() => normalizeSubmission(submission(), actor(), storedObject({ encryptionMode: 'AES256' })), /aws:kms/i);
});

test('PHI, individual health records, credentials, person-level data, or missing rights are rejected', () => {
  for (const patch of [
    { containsPhi: true },
    { containsIndividualHealthRecords: true },
    { containsCredentialsOrSecrets: true },
    { aggregationLevel: 'person_level' },
    { usageRightsConfirmed: false },
  ]) {
    const document = normalizeSubmission(submission(patch), actor(), storedObject(), '2026-08-24T12:00:00.000Z');
    assert.equal(document.admissionState, 'rejected');
    assert.ok(document.reasonCodes.length > 0);
  }
});

test('unsupported media and incomplete security scan quarantine rather than silently admitting evidence', () => {
  const media = normalizeSubmission(submission(), actor(), storedObject({ mediaType: 'application/zip' }), '2026-08-24T12:00:00.000Z');
  assert.equal(media.admissionState, 'quarantined');
  assert.ok(media.reasonCodes.includes('unsupported_media_type'));

  const pending = normalizeSubmission(submission(), actor(), storedObject({ securityScanStatus: 'pending' }), '2026-08-24T12:00:00.000Z');
  assert.equal(pending.admissionState, 'quarantined');
  assert.ok(pending.reasonCodes.includes('security_scan:pending'));
});

test('only eligible unexpired tenant evidence can receive an accepted human review', () => {
  const eligible = normalizeSubmission(submission(), actor(), storedObject(), '2026-08-24T12:00:00.000Z');
  const review = normalizeReview(eligible, {
    decision: 'accepted',
    reasonCodes: ['reviewed_source_and_rights'],
    rationale: 'Reviewed for tenant-only planning use.',
  }, actor(), '2026-08-24T13:00:00.000Z');
  assert.equal(review.decision, 'accepted');
  assert.equal(review.reviewedBy, 'planner-1');

  const rejected = normalizeSubmission(submission({ containsPhi: true }), actor(), storedObject(), '2026-08-24T12:00:00.000Z');
  assert.throws(() => normalizeReview(rejected, {
    decision: 'accepted',
    reasonCodes: ['attempt'],
    rationale: 'Should fail.',
  }, actor(), '2026-08-24T13:00:00.000Z'), /only eligible/i);
});

test('latest review controls tenant-only use and later rejection blocks an earlier acceptance', () => {
  const document = normalizeSubmission(submission(), actor(), storedObject(), '2026-08-24T12:00:00.000Z');
  const accepted = normalizeReview(document, {
    decision: 'accepted',
    reasonCodes: ['reviewed'],
    rationale: 'Accepted for tenant use.',
  }, actor(), '2026-08-24T13:00:00.000Z');
  assert.equal(authorizeUse(document, [accepted], actor(), { geographyId: 'county:36001', asOf: '2026-08-24T14:00:00.000Z' }).status, 'ready');

  const rejected = normalizeReview(document, {
    decision: 'rejected',
    reasonCodes: ['superseding_concern'],
    rationale: 'Later review blocks use.',
  }, actor(), '2026-08-24T15:00:00.000Z');
  const decision = authorizeUse(document, [accepted, rejected], actor(), { geographyId: 'county:36001', asOf: '2026-08-24T16:00:00.000Z' });
  assert.equal(decision.status, 'blocked');
  assert.ok(decision.reasonCodes.includes('latest_review:rejected'));
});

test('sanitized tenant evidence never exposes storage location, KMS identity, or public/institutional promotion', () => {
  const document = normalizeSubmission(submission(), actor(), storedObject(), '2026-08-24T12:00:00.000Z');
  const view = sanitizeDocument(document);
  const text = JSON.stringify(view);
  assert.equal(text.includes('storage_bucket'), false);
  assert.equal(text.includes('cbcap-private-evidence-prod'), false);
  assert.equal(text.includes('kms:'), false);
  assert.equal(text.includes('/upload-1/evidence.pdf'), false);
  assert.equal(view.storageLocationExposed, false);
  assert.equal(view.publicEvidence, false);
  assert.equal(view.institutionalTruth, false);
});

test('in-memory private evidence store enforces tenant scope', async () => {
  const store = new InMemoryTenantPrivateEvidenceStore({ tenantId: 'tenant-a' });
  const document = normalizeSubmission(submission(), actor(), storedObject(), '2026-08-24T12:00:00.000Z');
  await store.createDocument(document);
  assert.equal((await store.listDocuments({ geographyId: 'county:36001' })).length, 1);
  await assert.rejects(() => store.createDocument({ ...document, tenantId: 'tenant-b' }), /tenant mismatch/i);
});
