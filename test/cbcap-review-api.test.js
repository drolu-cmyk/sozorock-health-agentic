const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPReviewApi } = require('../server/cbcap-review-api');

function fixture(options = {}) {
  const calls = { checkpoint: 0, resume: 0, approval: null, authorization: 0 };
  const engine = {
    async getRunReviewCheckpoint(runId) {
      calls.checkpoint += 1;
      if (options.checkpoint === null) return null;
      return options.checkpoint || {
        runId,
        tenantId: 'tenant-a',
        status: 'awaiting_human_review',
        resumeAt: 'publish',
        evidenceReleaseId: 'release-1',
        countyFips: '36001',
        draft: { title: 'Draft' },
        checkpointSequence: 14,
      };
    },
    async resumeCountyPlan(runId, approval) {
      calls.resume += 1;
      calls.approval = structuredClone(approval);
      if (options.resumeError) throw new Error('resume failed');
      return options.result || { type: 'cbcap_county_plan', runId, status: 'approved_output' };
    },
  };
  const authorizer = async (context, request) => {
    calls.authorization += 1;
    if (options.authorizationError) throw new Error('auth failed');
    if (options.actor === null) return null;
    return options.actor || {
      subject: 'reviewer-subject-1',
      tenantId: 'tenant-a',
      contextSeen: Boolean(context),
      actionSeen: request.action,
    };
  };
  const api = createCBCAPReviewApi({
    engine,
    authorizer,
    clock: () => '2026-08-24T00:30:00.000Z',
  });
  return { api, calls };
}

test('review service constructs approval from authenticated actor and saved release', async () => {
  const { api, calls } = fixture();
  const result = await api.handle('run-1', { decision: 'approve' }, { requestId: 'req-1' });

  assert.equal(result.statusCode, 200);
  assert.equal(calls.authorization, 1);
  assert.equal(calls.checkpoint, 1);
  assert.equal(calls.resume, 1);
  assert.deepEqual(calls.approval, {
    status: 'approved',
    decision: 'approve',
    by: 'reviewer-subject-1',
    scope: 'county_plan',
    reviewedAt: '2026-08-24T00:30:00.000Z',
    objectId: 'run-1',
    evidenceReleaseId: 'release-1',
  });
});

test('client cannot submit reviewer or release identity in the decision payload', async () => {
  const { api, calls } = fixture();
  const result = await api.handle('run-1', {
    decision: 'approve',
    by: 'client-supplied-reviewer',
  });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /only the decision field/);
  assert.equal(calls.authorization, 0);
  assert.equal(calls.resume, 0);
});

test('unauthorized reviewer cannot read checkpoint state', async () => {
  const { api, calls } = fixture({ actor: null });
  const result = await api.handle('run-1', { decision: 'approve' });
  assert.equal(result.statusCode, 403);
  assert.equal(calls.authorization, 1);
  assert.equal(calls.checkpoint, 0);
  assert.equal(calls.resume, 0);
});

test('tenant mismatch blocks continuation', async () => {
  const { api, calls } = fixture({
    actor: { subject: 'reviewer-subject-1', tenantId: 'tenant-b' },
  });
  const result = await api.handle('run-1', { decision: 'approve' });
  assert.equal(result.statusCode, 403);
  assert.equal(calls.checkpoint, 1);
  assert.equal(calls.resume, 0);
});

test('non-resumable checkpoint returns conflict', async () => {
  const { api, calls } = fixture({
    checkpoint: {
      runId: 'run-1',
      tenantId: 'tenant-a',
      status: 'awaiting_human_review',
      resumeAt: null,
      evidenceReleaseId: 'release-1',
    },
  });
  const result = await api.handle('run-1', { decision: 'approve' });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'run_not_resumable');
  assert.equal(calls.resume, 0);
});

test('missing run returns 404 after authorization', async () => {
  const { api, calls } = fixture({ checkpoint: null });
  const result = await api.handle('run-missing', { decision: 'approve' });
  assert.equal(result.statusCode, 404);
  assert.equal(calls.authorization, 1);
  assert.equal(calls.checkpoint, 1);
});

test('failed continuation is sanitized and does not expose engine error text', async () => {
  const { api } = fixture({ resumeError: true });
  const result = await api.handle('run-1', { decision: 'approve' });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'review_continuation_failed');
  assert.equal(JSON.stringify(result.body).includes('resume failed'), false);
});
