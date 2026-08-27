const {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} = require('@aws-sdk/client-s3');
const { tenantEvidencePartition } = require('../packages/runtime/tenant-private-evidence');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

const UPLOAD_ID = /^[A-Za-z0-9._:-]{1,240}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SCAN_STATES = new Set(['clean', 'blocked', 'pending']);

function required(value, label, max = 2048) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > max) throw new Error(`${label} is invalid.`);
  return normalized;
}

function normalizeHash(metadata = {}) {
  const raw = String(metadata['content-sha256'] || metadata.sha256 || '').trim().toLowerCase();
  const hex = raw.startsWith('sha256:') ? raw.slice(7) : raw;
  if (!SHA256_HEX.test(hex)) throw new Error('Tenant evidence object is missing a valid content SHA-256 metadata value.');
  return `sha256:${hex}`;
}

function normalizeScanStatus(metadata = {}) {
  const value = String(metadata['security-scan-status'] || metadata.securityscanstatus || 'pending').trim().toLowerCase();
  if (!SCAN_STATES.has(value)) throw new Error('Tenant evidence object has an invalid security scan status.');
  return value;
}

function notFound(error) {
  return error?.name === 'NotFound'
    || error?.name === 'NoSuchKey'
    || error?.$metadata?.httpStatusCode === 404;
}

function createS3PrivateEvidenceObjectResolver(options = {}) {
  const region = required(options.region || process.env.AWS_REGION, 'AWS region', 64);
  const bucket = required(options.bucket || process.env.CB_CAP_PRIVATE_EVIDENCE_BUCKET, 'Private evidence bucket', 63);
  const kmsKeyArn = required(options.kmsKeyArn || process.env.CB_CAP_PRIVATE_EVIDENCE_KMS_KEY_ARN, 'Private evidence KMS key ARN', 500);
  const client = options.client || new S3Client({ region });
  if (!client || typeof client.send !== 'function') throw new Error('Private evidence S3 client is unavailable.');

  return async function privateEvidenceObjectForActor(actorInput, uploadIdInput) {
    const actor = validateWorkspaceActor(actorInput);
    const uploadId = required(uploadIdInput, 'uploadId', 240);
    if (!UPLOAD_ID.test(uploadId)) throw new Error('uploadId contains unsupported characters.');

    const prefix = `tenant-evidence/${tenantEvidencePartition(actor.tenantId)}/${uploadId}/`;
    const listing = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 2,
    }));
    const objects = (listing?.Contents || []).filter((entry) => typeof entry?.Key === 'string' && entry.Key.startsWith(prefix));
    if (objects.length === 0) return null;
    if (objects.length !== 1 || listing?.IsTruncated === true) {
      throw new Error('Tenant evidence upload resolves to an ambiguous object set.');
    }

    const key = objects[0].Key;
    let head;
    try {
      head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }

    const versionId = required(head?.VersionId, 'Tenant evidence version ID', 1000);
    const byteLength = Number(head?.ContentLength);
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw new Error('Tenant evidence object has an invalid byte length.');
    const mediaType = required(head?.ContentType, 'Tenant evidence media type', 240).toLowerCase();
    if (head?.ServerSideEncryption !== 'aws:kms') throw new Error('Tenant evidence object is not protected by AWS KMS encryption.');
    if (required(head?.SSEKMSKeyId, 'Tenant evidence KMS key', 500) !== kmsKeyArn) {
      throw new Error('Tenant evidence object is not protected by the approved KMS key.');
    }

    return {
      uploadId,
      bucket,
      key,
      versionId,
      contentHash: normalizeHash(head?.Metadata || {}),
      byteLength,
      mediaType,
      encryptionMode: 'aws:kms',
      kmsKeyArn,
      publicAccessBlocked: true,
      securityScanStatus: normalizeScanStatus(head?.Metadata || {}),
    };
  };
}

module.exports = {
  createS3PrivateEvidenceObjectResolver,
  normalizeHash,
  normalizeScanStatus,
};
