const crypto = require('crypto');
const { validateWorkspaceActor } = require('./workspace-identity');

const CONTRACT = 'cbcap.tenant-private-evidence.v1';
const ALLOWED_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);
const SENSITIVITIES = new Set(['internal', 'confidential', 'restricted']);
const RIGHTS_BASES = new Set(['organization_owned', 'partner_authorized', 'licensed_for_use']);
const AGGREGATION_LEVELS = new Set(['organizational', 'community_aggregate', 'program_aggregate', 'person_level']);
const REVIEW_DECISIONS = new Set(['accepted', 'rejected', 'needs_revision']);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const KMS_ARN = /^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[A-Za-z0-9-]+$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function requiredString(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function dateOnly(value, label, allowNull = true) {
  if ((value === null || value === undefined || value === '') && allowNull) return null;
  const normalized = requiredString(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`))) {
    throw new Error(`${label} must be an ISO date.`);
  }
  return normalized;
}

function tenantEvidencePartition(tenantId) {
  return crypto.createHash('sha256').update(requiredString(tenantId, 'tenantId', 200)).digest('hex').slice(0, 32);
}

function validateStoredObject(value, actorTenantId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resolved tenant evidence object is required.');
  const uploadId = requiredString(value.uploadId, 'storedObject.uploadId', 240);
  const bucket = requiredString(value.bucket, 'storedObject.bucket', 63);
  if (!BUCKET.test(bucket)) throw new Error('storedObject.bucket is invalid.');
  const key = requiredString(value.key, 'storedObject.key', 2048);
  if (key.startsWith('/') || key.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('storedObject.key contains an unsafe path.');
  }
  const expectedPrefix = `tenant-evidence/${tenantEvidencePartition(actorTenantId)}/`;
  if (!key.startsWith(expectedPrefix)) throw new Error('Stored tenant evidence object does not match the authenticated tenant partition.');
  const versionId = requiredString(value.versionId, 'storedObject.versionId', 1000);
  const contentHash = requiredString(value.contentHash, 'storedObject.contentHash', 80).toLowerCase();
  if (!SHA256.test(contentHash)) throw new Error('storedObject.contentHash must be a sha256 hash.');
  const byteLength = Number(value.byteLength);
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw new Error('storedObject.byteLength must be a positive integer.');
  const mediaType = requiredString(value.mediaType, 'storedObject.mediaType', 240).toLowerCase();
  const encryptionMode = requiredString(value.encryptionMode, 'storedObject.encryptionMode', 80);
  if (encryptionMode !== 'aws:kms') throw new Error('Tenant evidence storage must use aws:kms encryption.');
  const kmsKeyArn = requiredString(value.kmsKeyArn, 'storedObject.kmsKeyArn', 500);
  if (!KMS_ARN.test(kmsKeyArn)) throw new Error('storedObject.kmsKeyArn is invalid.');
  if (value.publicAccessBlocked !== true) throw new Error('Tenant evidence storage must block public access.');
  const securityScanStatus = requiredString(value.securityScanStatus, 'storedObject.securityScanStatus', 80);
  if (!['clean', 'blocked', 'pending'].includes(securityScanStatus)) throw new Error('storedObject.securityScanStatus is invalid.');
  return {
    uploadId,
    bucket,
    key,
    versionId,
    contentHash,
    byteLength,
    mediaType,
    encryptionMode,
    kmsKeyArn,
    publicAccessBlocked: true,
    securityScanStatus,
  };
}

function normalizeSubmission(input, actorInput, storedObjectInput, now = new Date().toISOString()) {
  const actor = validateWorkspaceActor(actorInput);
  if (actor.actorType !== 'human') throw new Error('Tenant-private evidence submission requires a human workspace actor.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Tenant-private evidence submission must be an object.');
  const storedObject = validateStoredObject(storedObjectInput, actor.tenantId);
  if (requiredString(input.uploadId, 'uploadId', 240) !== storedObject.uploadId) throw new Error('Resolved upload does not match requested uploadId.');

  if (!Array.isArray(input.geographyIds) || input.geographyIds.length === 0 || input.geographyIds.length > 25) {
    throw new Error('geographyIds must contain between 1 and 25 items.');
  }
  const geographyIds = input.geographyIds.map((item, index) => requiredString(item, `geographyIds[${index}]`, 240));
  if (new Set(geographyIds).size !== geographyIds.length) throw new Error('geographyIds must be unique.');
  const submittedInRunId = requiredString(input.submittedInRunId, 'submittedInRunId', 240);
  const documentType = requiredString(input.documentType, 'documentType', 160);
  const sourceLabel = requiredString(input.sourceLabel, 'sourceLabel', 500);
  const sensitivity = requiredString(input.sensitivity, 'sensitivity', 40);
  const rightsBasis = requiredString(input.rightsBasis, 'rightsBasis', 80);
  const aggregationLevel = requiredString(input.aggregationLevel, 'aggregationLevel', 80);
  if (!SENSITIVITIES.has(sensitivity)) throw new Error('sensitivity is not supported.');
  if (!RIGHTS_BASES.has(rightsBasis)) throw new Error('rightsBasis is not supported.');
  if (!AGGREGATION_LEVELS.has(aggregationLevel)) throw new Error('aggregationLevel is not supported.');
  if (typeof input.usageRightsConfirmed !== 'boolean') throw new Error('usageRightsConfirmed must be boolean.');
  for (const flag of ['containsPhi', 'containsIndividualHealthRecords', 'containsCredentialsOrSecrets']) {
    if (typeof input[flag] !== 'boolean') throw new Error(`${flag} must be boolean.`);
  }
  const retentionUntil = dateOnly(input.retentionUntil, 'retentionUntil');
  const submittedAt = new Date(now).toISOString();
  if (retentionUntil && retentionUntil < submittedAt.slice(0, 10)) throw new Error('retentionUntil is already expired.');

  const reasonCodes = [];
  let admissionState = 'eligible_for_review';
  if (!ALLOWED_MEDIA_TYPES.has(storedObject.mediaType)) {
    admissionState = 'quarantined';
    reasonCodes.push('unsupported_media_type');
  }
  if (storedObject.securityScanStatus !== 'clean') {
    admissionState = 'quarantined';
    reasonCodes.push(`security_scan:${storedObject.securityScanStatus}`);
  }
  if (!input.usageRightsConfirmed) {
    admissionState = 'rejected';
    reasonCodes.push('usage_rights_not_confirmed');
  }
  if (aggregationLevel === 'person_level') {
    admissionState = 'rejected';
    reasonCodes.push('person_level_data_prohibited');
  }
  if (input.containsPhi) {
    admissionState = 'rejected';
    reasonCodes.push('phi_prohibited');
  }
  if (input.containsIndividualHealthRecords) {
    admissionState = 'rejected';
    reasonCodes.push('individual_health_records_prohibited');
  }
  if (input.containsCredentialsOrSecrets) {
    admissionState = 'rejected';
    reasonCodes.push('credentials_or_secrets_prohibited');
  }

  const identity = JSON.stringify({
    tenantId: actor.tenantId,
    geographyIds: [...geographyIds].sort(),
    submittedInRunId,
    uploadId: storedObject.uploadId,
    versionId: storedObject.versionId,
    contentHash: storedObject.contentHash,
  });
  const id = `tenant-evidence:sha256:${crypto.createHash('sha256').update(identity).digest('hex')}`;

  return {
    id,
    tenantId: actor.tenantId,
    geographyIds,
    submittedInRunId,
    storedObject,
    documentType,
    sourceLabel,
    sensitivity,
    rightsBasis,
    usageRightsConfirmed: input.usageRightsConfirmed,
    aggregationLevel,
    containsPhi: input.containsPhi,
    containsIndividualHealthRecords: input.containsIndividualHealthRecords,
    containsCredentialsOrSecrets: input.containsCredentialsOrSecrets,
    admissionState,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    submittedBy: actor.principalId,
    submittedAt,
    retentionUntil,
  };
}

function normalizeReview(document, input, actorInput, now = new Date().toISOString()) {
  const actor = validateWorkspaceActor(actorInput);
  if (!document || document.tenantId !== actor.tenantId) throw new Error('Tenant evidence review tenant mismatch.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Tenant evidence review must be an object.');
  const decision = requiredString(input.decision, 'decision', 40);
  if (!REVIEW_DECISIONS.has(decision)) throw new Error('decision is not supported.');
  if (!Array.isArray(input.reasonCodes) || input.reasonCodes.length === 0 || input.reasonCodes.length > 25) {
    throw new Error('reasonCodes must contain between 1 and 25 items.');
  }
  const reasonCodes = [...new Set(input.reasonCodes.map((item, index) => requiredString(item, `reasonCodes[${index}]`, 200)))].sort();
  const rationale = requiredString(input.rationale, 'rationale', 4000);
  const reviewedAt = new Date(now).toISOString();
  if (decision === 'accepted' && document.admissionState !== 'eligible_for_review') {
    throw new Error('Only eligible tenant evidence can be accepted.');
  }
  if (decision === 'accepted' && document.retentionUntil && document.retentionUntil < reviewedAt.slice(0, 10)) {
    throw new Error('Expired tenant evidence cannot be accepted.');
  }
  if (decision === 'needs_revision' && document.admissionState === 'rejected') {
    throw new Error('Rejected tenant evidence cannot be changed to needs_revision.');
  }
  const id = `tenant-evidence-review:${crypto.randomUUID()}`;
  return {
    id,
    documentId: document.id,
    tenantId: document.tenantId,
    decision,
    reasonCodes,
    rationale,
    reviewedBy: actor.principalId,
    reviewedAt,
  };
}

function latestReview(document, reviews) {
  const matching = (reviews || []).filter((review) => review.documentId === document.id && review.tenantId === document.tenantId);
  if (!matching.length) return null;
  const sorted = [...matching].sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)) || String(b.id).localeCompare(String(a.id)));
  if (sorted.length > 1 && sorted[0].reviewedAt === sorted[1].reviewedAt) throw new Error('Tenant evidence review history has an ambiguous latest timestamp.');
  return sorted[0];
}

function authorizeUse(document, reviews, actorInput, options = {}) {
  const actor = validateWorkspaceActor(actorInput);
  if (!document || document.tenantId !== actor.tenantId) throw new Error('Tenant evidence use tenant mismatch.');
  const asOf = new Date(options.asOf || new Date().toISOString());
  if (Number.isNaN(asOf.getTime())) throw new Error('asOf is invalid.');
  const geographyId = options.geographyId ? requiredString(options.geographyId, 'geographyId', 240) : null;
  const reasonCodes = [];
  if (geographyId && !document.geographyIds.includes(geographyId)) reasonCodes.push('document_not_applicable_to_current_geography');
  if (document.admissionState !== 'eligible_for_review') reasonCodes.push(`admission:${document.admissionState}`);
  if (document.retentionUntil && document.retentionUntil < asOf.toISOString().slice(0, 10)) reasonCodes.push('retention_expired');
  const review = latestReview(document, reviews);
  if (!review) reasonCodes.push('human_review_missing');
  else if (review.decision !== 'accepted') reasonCodes.push(`latest_review:${review.decision}`);
  return {
    status: reasonCodes.length ? 'blocked' : 'ready',
    documentId: document.id,
    latestReviewId: review?.id || null,
    reasonCodes: [...new Set(reasonCodes)].sort(),
  };
}

function sanitizeDocument(document, review = null) {
  return {
    contract: CONTRACT,
    documentId: document.id,
    geographyIds: [...document.geographyIds],
    submittedInRunId: document.submittedInRunId,
    documentType: document.documentType,
    sourceLabel: document.sourceLabel,
    sensitivity: document.sensitivity,
    rightsBasis: document.rightsBasis,
    aggregationLevel: document.aggregationLevel,
    admissionState: document.admissionState,
    reasonCodes: [...document.reasonCodes],
    submittedBy: document.submittedBy,
    submittedAt: document.submittedAt,
    retentionUntil: document.retentionUntil,
    contentHash: document.storedObject.contentHash,
    mediaType: document.storedObject.mediaType,
    byteLength: document.storedObject.byteLength,
    latestReview: review ? {
      reviewId: review.id,
      decision: review.decision,
      reasonCodes: [...review.reasonCodes],
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
    } : null,
    storageLocationExposed: false,
    publicEvidence: false,
    institutionalTruth: false,
  };
}

class InMemoryTenantPrivateEvidenceStore {
  constructor(options = {}) {
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
    this.documents = new Map();
    this.reviews = [];
  }

  async createDocument(document) {
    if (document.tenantId !== this.tenantId) throw new Error('Tenant evidence document tenant mismatch.');
    if (!this.documents.has(document.id)) this.documents.set(document.id, structuredClone(document));
    return structuredClone(this.documents.get(document.id));
  }

  async getDocument(documentId) {
    const document = this.documents.get(requiredString(documentId, 'documentId', 240));
    return document ? structuredClone(document) : null;
  }

  async listDocuments(options = {}) {
    const geographyId = options.geographyId ? requiredString(options.geographyId, 'geographyId', 240) : null;
    return [...this.documents.values()]
      .filter((document) => !geographyId || document.geographyIds.includes(geographyId))
      .map((document) => structuredClone(document));
  }

  async appendReview(review) {
    if (review.tenantId !== this.tenantId) throw new Error('Tenant evidence review tenant mismatch.');
    const existingDocument = this.documents.get(review.documentId);
    if (!existingDocument) throw new Error('Tenant evidence document was not found.');
    if (this.reviews.some((item) => item.id === review.id)) return structuredClone(this.reviews.find((item) => item.id === review.id));
    if (this.reviews.some((item) => item.documentId === review.documentId && item.reviewedAt === review.reviewedAt)) {
      throw new Error('Tenant evidence review timestamp conflict.');
    }
    this.reviews.push(structuredClone(review));
    return structuredClone(review);
  }

  async listReviews(documentId) {
    return this.reviews.filter((review) => review.documentId === documentId).map((review) => structuredClone(review));
  }
}

module.exports = {
  ALLOWED_MEDIA_TYPES,
  CONTRACT,
  InMemoryTenantPrivateEvidenceStore,
  authorizeUse,
  latestReview,
  normalizeReview,
  normalizeSubmission,
  sanitizeDocument,
  tenantEvidencePartition,
  validateStoredObject,
};
