const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');
const {
  authorizeUse,
  latestReview,
  normalizeReview,
  normalizeSubmission,
  sanitizeDocument,
} = require('../packages/runtime/tenant-private-evidence');

const SUBMISSION_FIELDS = new Set([
  'uploadId',
  'geographyIds',
  'submittedInRunId',
  'documentType',
  'sourceLabel',
  'sensitivity',
  'rightsBasis',
  'usageRightsConfirmed',
  'aggregationLevel',
  'containsPhi',
  'containsIndividualHealthRecords',
  'containsCredentialsOrSecrets',
  'retentionUntil',
]);
const REVIEW_FIELDS = new Set(['decision', 'reasonCodes', 'rationale']);
const QUERY_FIELDS = new Set(['geographyId', 'asOf']);

function unknownFields(input, allowed) {
  return Object.keys(input || {}).filter((key) => !allowed.has(key));
}

function badRequest(error) {
  return { statusCode: 400, body: { error: error?.message || 'Invalid tenant-private evidence request.' } };
}

function createCBCAPPrivateEvidenceApi(options = {}) {
  if (typeof options.objectForActor !== 'function') throw new Error('Tenant-private evidence API requires objectForActor(actor, uploadId).');
  if (typeof options.storeForActor !== 'function') throw new Error('Tenant-private evidence API requires storeForActor(actor).');
  const clock = options.clock || (() => new Date().toISOString());
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};

  async function dependencies(context) {
    const actor = validateWorkspaceActor(context?.workspaceActor);
    const store = await options.storeForActor(actor);
    if (!store
      || typeof store.createDocument !== 'function'
      || typeof store.getDocument !== 'function'
      || typeof store.listDocuments !== 'function'
      || typeof store.appendReview !== 'function'
      || typeof store.listReviews !== 'function') {
      throw new Error('Tenant-private evidence store is unavailable.');
    }
    return { actor, store };
  }

  return {
    async submit(input = {}, context = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest(new Error('Submission must be an object.'));
      const unknown = unknownFields(input, SUBMISSION_FIELDS);
      if (unknown.length) return badRequest(new Error(`Unsupported submission fields: ${unknown.sort().join(', ')}.`));
      let actor;
      let store;
      try {
        ({ actor, store } = await dependencies(context));
      } catch {
        return { statusCode: 503, body: { error: 'Tenant-private evidence runtime is unavailable.' } };
      }

      try {
        const uploadId = typeof input.uploadId === 'string' ? input.uploadId.trim() : '';
        if (!uploadId) throw new Error('uploadId is required.');
        const storedObject = await options.objectForActor(actor, uploadId);
        if (!storedObject) return { statusCode: 404, body: { error: 'Tenant-private evidence upload was not found.' } };
        const document = normalizeSubmission(input, actor, storedObject, clock());
        const saved = await store.createDocument(document);
        const response = sanitizeDocument(saved, null);
        auditSink({
          action: 'cbcap_private_evidence_submitted',
          tenantId: actor.tenantId,
          principalId: actor.principalId,
          documentId: saved.id,
          admissionState: saved.admissionState,
        });
        return { statusCode: 201, body: response };
      } catch (error) {
        auditSink({ action: 'cbcap_private_evidence_submission_rejected', tenantId: actor.tenantId, principalId: actor.principalId, errorName: error?.name || 'Error' });
        return badRequest(error);
      }
    },

    async review(documentId, input = {}, context = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest(new Error('Review must be an object.'));
      const unknown = unknownFields(input, REVIEW_FIELDS);
      if (unknown.length) return badRequest(new Error(`Unsupported review fields: ${unknown.sort().join(', ')}.`));
      let actor;
      let store;
      try {
        ({ actor, store } = await dependencies(context));
      } catch {
        return { statusCode: 503, body: { error: 'Tenant-private evidence runtime is unavailable.' } };
      }

      try {
        const document = await store.getDocument(documentId);
        if (!document) return { statusCode: 404, body: { error: 'Tenant-private evidence document was not found.' } };
        const review = normalizeReview(document, input, actor, clock());
        const savedReview = await store.appendReview(review);
        const savedDocument = await store.getDocument(document.id);
        auditSink({
          action: 'cbcap_private_evidence_reviewed',
          tenantId: actor.tenantId,
          principalId: actor.principalId,
          documentId: document.id,
          decision: savedReview.decision,
        });
        return { statusCode: 201, body: sanitizeDocument(savedDocument, savedReview) };
      } catch (error) {
        return badRequest(error);
      }
    },

    async query(input = {}, context = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest(new Error('Query must be an object.'));
      const unknown = unknownFields(input, QUERY_FIELDS);
      if (unknown.length) return badRequest(new Error(`Unsupported query fields: ${unknown.sort().join(', ')}.`));
      let actor;
      let store;
      try {
        ({ actor, store } = await dependencies(context));
      } catch {
        return { statusCode: 503, body: { error: 'Tenant-private evidence runtime is unavailable.' } };
      }

      try {
        const geographyId = typeof input.geographyId === 'string' ? input.geographyId.trim() : '';
        if (!geographyId) throw new Error('geographyId is required.');
        const asOf = input.asOf || clock();
        const documents = await store.listDocuments({ geographyId });
        const ready = [];
        const blockedDocumentIds = [];
        for (const document of documents) {
          const reviews = await store.listReviews(document.id);
          const decision = authorizeUse(document, reviews, actor, { geographyId, asOf });
          if (decision.status !== 'ready') {
            blockedDocumentIds.push(document.id);
            continue;
          }
          ready.push(sanitizeDocument(document, latestReview(document, reviews)));
        }
        auditSink({
          action: 'cbcap_private_evidence_queried',
          tenantId: actor.tenantId,
          principalId: actor.principalId,
          geographyId,
          readyCount: ready.length,
          blockedCount: blockedDocumentIds.length,
        });
        return {
          statusCode: 200,
          body: {
            contract: 'cbcap.tenant-private-evidence.v1',
            geographyId,
            documents: ready,
            blockedDocumentIds: [...new Set(blockedDocumentIds)].sort(),
            publicEvidenceModified: false,
            institutionalTruthPromoted: false,
          },
        };
      } catch (error) {
        return badRequest(error);
      }
    },
  };
}

module.exports = { createCBCAPPrivateEvidenceApi };
