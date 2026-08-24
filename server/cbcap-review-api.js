function requiredString(value, label, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function createCBCAPReviewApi(options = {}) {
  const engine = options.engine;
  const authorizer = options.authorizer;
  const clock = options.clock || (() => new Date().toISOString());
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};

  if (!engine || typeof engine.getRunReviewCheckpoint !== 'function' || typeof engine.resumeCountyPlan !== 'function') {
    throw new Error('CB-CAP review API requires a resumable planning engine.');
  }
  if (typeof authorizer !== 'function') {
    throw new Error('CB-CAP review API requires an authenticated review authorizer.');
  }

  return {
    async handle(runIdInput, input = {}, context = {}) {
      let runId;
      try {
        runId = requiredString(runIdInput, 'runId', 128);
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { statusCode: 400, body: { error: 'request body must be an object' } };
      }
      const keys = Object.keys(input);
      if (keys.some((key) => key !== 'decision')) {
        return { statusCode: 400, body: { error: 'review request accepts only the decision field' } };
      }
      if (input.decision !== 'approve') {
        return { statusCode: 400, body: { error: 'decision must be approve' } };
      }

      let actor;
      try {
        actor = await authorizer(context, { action: 'approve_county_plan', runId });
      } catch {
        return { statusCode: 403, body: { error: 'review authorization failed' } };
      }
      if (!actor || actor.ok === false) {
        return { statusCode: 403, body: { error: 'review authorization failed' } };
      }

      let subject;
      let tenantId;
      try {
        subject = requiredString(actor.subject, 'authorized reviewer subject', 200);
        tenantId = requiredString(actor.tenantId, 'authorized tenant', 200);
      } catch {
        return { statusCode: 403, body: { error: 'review authorization failed' } };
      }

      let checkpoint;
      try {
        checkpoint = await engine.getRunReviewCheckpoint(runId);
      } catch {
        return { statusCode: 500, body: { error: 'review state could not be loaded' } };
      }
      if (!checkpoint) return { statusCode: 404, body: { error: 'run not found' } };
      if (!checkpoint.tenantId || checkpoint.tenantId !== tenantId) {
        return { statusCode: 403, body: { error: 'review authorization failed' } };
      }
      if (checkpoint.status !== 'awaiting_human_review' || checkpoint.resumeAt !== 'publish') {
        return {
          statusCode: 409,
          body: {
            code: 'run_not_resumable',
            error: 'This run is not awaiting a resumable publish review.',
          },
        };
      }
      if (!checkpoint.evidenceReleaseId) {
        return { statusCode: 409, body: { code: 'missing_release_identity', error: 'Run evidence release identity is unavailable.' } };
      }

      const approval = {
        status: 'approved',
        decision: 'approve',
        by: subject,
        scope: 'county_plan',
        reviewedAt: clock(),
        objectId: runId,
        evidenceReleaseId: checkpoint.evidenceReleaseId,
      };

      let result;
      try {
        result = await engine.resumeCountyPlan(runId, approval);
      } catch {
        return { statusCode: 409, body: { code: 'review_continuation_failed', error: 'The saved run could not be continued.' } };
      }

      auditSink({
        action: 'cbcap_review_approved',
        runId,
        tenantId,
        reviewer: subject,
        releaseId: checkpoint.evidenceReleaseId,
        status: result.status,
      });

      if (result.status !== 'approved_output') {
        return { statusCode: 422, body: result };
      }
      return { statusCode: 200, body: result };
    },
  };
}

module.exports = { createCBCAPReviewApi };
