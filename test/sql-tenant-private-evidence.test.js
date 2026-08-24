const test = require('node:test');
const assert = require('node:assert/strict');
const { SqlTenantPrivateEvidenceStore, reviewUuid } = require('../packages/runtime/sql-tenant-private-evidence');

const REVIEW_UUID = '12345678-1234-4234-9234-123456789012';

function document() {
  return {
    id: `tenant-evidence:sha256:${'a'.repeat(64)}`,
    tenantId: 'tenant-a',
    geographyIds: ['county:36001'],
    submittedInRunId: 'run-1',
    storedObject: {
      uploadId: 'upload-1',
      bucket: 'private-evidence-bucket',
      key: 'tenant-evidence/partition/upload-1/evidence.pdf',
      versionId: 'v1',
      contentHash: `sha256:${'b'.repeat(64)}`,
      byteLength: 1000,
      mediaType: 'application/pdf',
      encryptionMode: 'aws:kms',
      kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012',
      publicAccessBlocked: true,
      securityScanStatus: 'clean',
    },
    documentType: 'local_plan',
    sourceLabel: 'Internal plan',
    sensitivity: 'confidential',
    rightsBasis: 'organization_owned',
    usageRightsConfirmed: true,
    aggregationLevel: 'organizational',
    containsPhi: false,
    containsIndividualHealthRecords: false,
    containsCredentialsOrSecrets: false,
    admissionState: 'eligible_for_review',
    reasonCodes: [],
    submittedBy: 'planner-1',
    submittedAt: '2026-08-24T12:00:00.000Z',
    retentionUntil: '2027-12-31',
  };
}

function documentRow() {
  const value = document();
  return {
    id: value.id,
    tenant_id: value.tenantId,
    geography_ids: value.geographyIds,
    submitted_in_run_id: value.submittedInRunId,
    upload_id: value.storedObject.uploadId,
    storage_bucket: value.storedObject.bucket,
    storage_key: value.storedObject.key,
    storage_version_id: value.storedObject.versionId,
    content_hash: value.storedObject.contentHash,
    byte_length: value.storedObject.byteLength,
    media_type: value.storedObject.mediaType,
    encryption_mode: value.storedObject.encryptionMode,
    kms_key_arn: value.storedObject.kmsKeyArn,
    public_access_blocked: true,
    security_scan_status: 'clean',
    document_type: value.documentType,
    source_label: value.sourceLabel,
    sensitivity: value.sensitivity,
    rights_basis: value.rightsBasis,
    usage_rights_confirmed: true,
    aggregation_level: value.aggregationLevel,
    contains_phi: false,
    contains_individual_health_records: false,
    contains_credentials_or_secrets: false,
    admission_state: value.admissionState,
    reason_codes: [],
    submitted_by: value.submittedBy,
    submitted_at: value.submittedAt,
    retention_until: value.retentionUntil,
  };
}

test('SQL private evidence document write carries tenant scope and immutable object metadata', async () => {
  const calls = [];
  const store = new SqlTenantPrivateEvidenceStore({
    tenantId: 'tenant-a',
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [documentRow()] };
    },
  });
  const saved = await store.createDocument(document());
  assert.equal(saved.tenantId, 'tenant-a');
  assert.match(calls[0].sql, /INSERT INTO cbcap_tenant_evidence_documents/i);
  assert.equal(calls[0].params[1], 'tenant-a');
  assert.equal(calls[0].params[5], 'private-evidence-bucket');
  assert.equal(calls[0].params[12], document().storedObject.kmsKeyArn);
});

test('SQL private evidence review strips only the API prefix before UUID persistence and restores it on read', async () => {
  const calls = [];
  const store = new SqlTenantPrivateEvidenceStore({
    tenantId: 'tenant-a',
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        id: REVIEW_UUID,
        tenant_id: 'tenant-a',
        document_id: document().id,
        decision: 'accepted',
        reason_codes: ['reviewed'],
        rationale: 'Reviewed.',
        reviewed_by: 'planner-1',
        reviewed_at: '2026-08-24T13:00:00.000Z',
      }] };
    },
  });
  const saved = await store.appendReview({
    id: `tenant-evidence-review:${REVIEW_UUID}`,
    tenantId: 'tenant-a',
    documentId: document().id,
    decision: 'accepted',
    reasonCodes: ['reviewed'],
    rationale: 'Reviewed.',
    reviewedBy: 'planner-1',
    reviewedAt: '2026-08-24T13:00:00.000Z',
  });
  assert.equal(calls[0].params[0], REVIEW_UUID);
  assert.equal(saved.id, `tenant-evidence-review:${REVIEW_UUID}`);
  assert.equal(reviewUuid(saved.id), REVIEW_UUID);
});

test('SQL private evidence store rejects cross-tenant document writes before querying', async () => {
  let called = false;
  const store = new SqlTenantPrivateEvidenceStore({
    tenantId: 'tenant-a',
    async query() { called = true; return { rows: [] }; },
  });
  await assert.rejects(() => store.createDocument({ ...document(), tenantId: 'tenant-b' }), /tenant mismatch/i);
  assert.equal(called, false);
});
