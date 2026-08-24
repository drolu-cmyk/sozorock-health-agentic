function requiredString(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function json(value, fallback = []) {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function iso(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function dateOnly(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function mapDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    geographyIds: json(row.geography_ids),
    submittedInRunId: row.submitted_in_run_id,
    storedObject: {
      uploadId: row.upload_id,
      bucket: row.storage_bucket,
      key: row.storage_key,
      versionId: row.storage_version_id,
      contentHash: row.content_hash,
      byteLength: Number(row.byte_length),
      mediaType: row.media_type,
      encryptionMode: row.encryption_mode,
      kmsKeyArn: row.kms_key_arn,
      publicAccessBlocked: row.public_access_blocked,
      securityScanStatus: row.security_scan_status,
    },
    documentType: row.document_type,
    sourceLabel: row.source_label,
    sensitivity: row.sensitivity,
    rightsBasis: row.rights_basis,
    usageRightsConfirmed: row.usage_rights_confirmed,
    aggregationLevel: row.aggregation_level,
    containsPhi: row.contains_phi,
    containsIndividualHealthRecords: row.contains_individual_health_records,
    containsCredentialsOrSecrets: row.contains_credentials_or_secrets,
    admissionState: row.admission_state,
    reasonCodes: json(row.reason_codes),
    submittedBy: row.submitted_by,
    submittedAt: iso(row.submitted_at),
    retentionUntil: dateOnly(row.retention_until),
  };
}

function reviewUuid(reviewId) {
  const value = requiredString(reviewId, 'review.id', 100);
  const prefix = 'tenant-evidence-review:';
  const uuid = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new Error('review.id must contain a UUID.');
  }
  return uuid;
}

function mapReview(row) {
  if (!row) return null;
  return {
    id: `tenant-evidence-review:${row.id}`,
    documentId: row.document_id,
    tenantId: row.tenant_id,
    decision: row.decision,
    reasonCodes: json(row.reason_codes),
    rationale: row.rationale,
    reviewedBy: row.reviewed_by,
    reviewedAt: iso(row.reviewed_at),
  };
}

class SqlTenantPrivateEvidenceStore {
  constructor(options = {}) {
    if (typeof options.query !== 'function') throw new Error('SqlTenantPrivateEvidenceStore requires query(sql, params).');
    this.query = options.query;
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
  }

  async createDocument(document) {
    if (!document || document.tenantId !== this.tenantId) throw new Error('Tenant evidence document tenant mismatch.');
    const object = document.storedObject;
    const result = await this.query(`WITH inserted AS (
      INSERT INTO cbcap_tenant_evidence_documents
        (id,tenant_id,geography_ids,submitted_in_run_id,upload_id,storage_bucket,storage_key,storage_version_id,
         content_hash,byte_length,media_type,encryption_mode,kms_key_arn,public_access_blocked,security_scan_status,
         document_type,source_label,sensitivity,rights_basis,usage_rights_confirmed,aggregation_level,contains_phi,
         contains_individual_health_records,contains_credentials_or_secrets,admission_state,reason_codes,submitted_by,
         submitted_at,retention_until)
      VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27,$28::timestamptz,$29::date)
      ON CONFLICT (tenant_id,id) DO NOTHING
      RETURNING *
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT * FROM cbcap_tenant_evidence_documents WHERE tenant_id=$2 AND id=$1
    LIMIT 1`, [
      document.id,
      this.tenantId,
      JSON.stringify(document.geographyIds),
      document.submittedInRunId,
      object.uploadId,
      object.bucket,
      object.key,
      object.versionId,
      object.contentHash,
      object.byteLength,
      object.mediaType,
      object.encryptionMode,
      object.kmsKeyArn,
      object.publicAccessBlocked,
      object.securityScanStatus,
      document.documentType,
      document.sourceLabel,
      document.sensitivity,
      document.rightsBasis,
      document.usageRightsConfirmed,
      document.aggregationLevel,
      document.containsPhi,
      document.containsIndividualHealthRecords,
      document.containsCredentialsOrSecrets,
      document.admissionState,
      JSON.stringify(document.reasonCodes),
      document.submittedBy,
      document.submittedAt,
      document.retentionUntil,
    ]);
    if (!result?.rows?.length) throw new Error('Tenant-private evidence document could not be persisted.');
    return mapDocument(result.rows[0]);
  }

  async getDocument(documentId) {
    const result = await this.query(
      'SELECT * FROM cbcap_tenant_evidence_documents WHERE tenant_id=$1 AND id=$2 LIMIT 1',
      [this.tenantId, requiredString(documentId, 'documentId', 240)],
    );
    return mapDocument(result?.rows?.[0]);
  }

  async listDocuments(options = {}) {
    const geographyId = options.geographyId ? requiredString(options.geographyId, 'geographyId', 240) : null;
    const result = await this.query(
      `SELECT * FROM cbcap_tenant_evidence_documents
       WHERE tenant_id=$1 AND ($2::text IS NULL OR geography_ids ? $2)
       ORDER BY submitted_at DESC,id`,
      [this.tenantId, geographyId],
    );
    return (result.rows || []).map(mapDocument);
  }

  async appendReview(review) {
    if (!review || review.tenantId !== this.tenantId) throw new Error('Tenant evidence review tenant mismatch.');
    const uuid = reviewUuid(review.id);
    const result = await this.query(`WITH inserted AS (
      INSERT INTO cbcap_tenant_evidence_reviews
        (id,tenant_id,document_id,decision,reason_codes,rationale,reviewed_by,reviewed_at)
      VALUES ($1::uuid,$2,$3,$4,$5::jsonb,$6,$7,$8::timestamptz)
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT * FROM cbcap_tenant_evidence_reviews WHERE id=$1::uuid AND tenant_id=$2
    LIMIT 1`, [
      uuid,
      this.tenantId,
      review.documentId,
      review.decision,
      JSON.stringify(review.reasonCodes),
      review.rationale,
      review.reviewedBy,
      review.reviewedAt,
    ]);
    if (!result?.rows?.length) throw new Error('Tenant-private evidence review could not be persisted.');
    return mapReview(result.rows[0]);
  }

  async listReviews(documentId) {
    const result = await this.query(
      `SELECT * FROM cbcap_tenant_evidence_reviews
       WHERE tenant_id=$1 AND document_id=$2
       ORDER BY reviewed_at DESC,id DESC`,
      [this.tenantId, requiredString(documentId, 'documentId', 240)],
    );
    return (result.rows || []).map(mapReview);
  }
}

module.exports = {
  SqlTenantPrivateEvidenceStore,
  mapDocument,
  mapReview,
  reviewUuid,
};
