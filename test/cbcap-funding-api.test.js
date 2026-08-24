const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPFundingApi } = require('../server/cbcap-funding-api');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'planner-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner One',
    ...overrides,
  };
}

function opportunity() {
  return {
    id: 'opp-1',
    title: 'Reviewed opportunity',
    reviewStatus: 'verified',
    openDate: '2026-08-01',
    closeDate: '2026-10-31',
    source: {
      sourceId: 'source-1',
      publisher: 'Public Funder',
      officialUrl: 'https://funder.example/opportunity',
      retrievedAt: '2026-08-20T00:00:00Z',
      reviewStatus: 'verified',
      sourceClaimIds: ['funding-source-claim'],
    },
    criteria: [{
      id: 'criterion-1',
      type: 'geography',
      description: 'County eligibility geography',
      acceptedValues: ['county:36001'],
      sourceClaimIds: ['funding-criterion-claim'],
    }],
  };
}

function applicant(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    organizationId: 'org-1',
    applicantTypes: ['county_government'],
    geographyIds: ['county:36001'],
    partnerOrganizationIds: [],
    designationEvidenceIds: [],
    supportingEvidenceIds: [],
    planPriorityClaimIds: [],
    barrierEvidenceIds: [],
    ...overrides,
  };
}

test('funding API accepts only lookup/context fields and derives opportunity and organization profile server-side', async () => {
  const seen = { opportunityId: null, actor: null };
  const api = createCBCAPFundingApi({
    opportunityForActor: async (workspaceActor, opportunityId) => {
      seen.actor = workspaceActor;
      seen.opportunityId = opportunityId;
      return opportunity();
    },
    applicantProfileForActor: async () => applicant(),
  });
  const result = await api.handle({
    opportunityId: 'opp-1',
    countyId: 'county:36001',
    asOf: '2026-08-23',
  }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.opportunityId, 'opp-1');
  assert.equal(result.body.requirementsStatus, 'matched');
  assert.equal(seen.opportunityId, 'opp-1');
  assert.equal(seen.actor.tenantId, 'tenant-a');
});

test('client cannot submit opportunity criteria or applicant evidence profile', async () => {
  const api = createCBCAPFundingApi({
    opportunityForActor: async () => opportunity(),
    applicantProfileForActor: async () => applicant(),
  });
  const forgedOpportunity = await api.handle({
    opportunityId: 'opp-1',
    countyId: 'county:36001',
    opportunity: { criteria: [] },
  }, { workspaceActor: actor() });
  assert.equal(forgedOpportunity.statusCode, 400);
  assert.match(forgedOpportunity.body.error, /Unsupported funding request field opportunity/);

  const forgedApplicant = await api.handle({
    opportunityId: 'opp-1',
    countyId: 'county:36001',
    applicant: { applicantTypes: ['anything'] },
  }, { workspaceActor: actor() });
  assert.equal(forgedApplicant.statusCode, 400);
  assert.match(forgedApplicant.body.error, /Unsupported funding request field applicant/);
});

test('funding API rejects cross-tenant organization profile', async () => {
  const api = createCBCAPFundingApi({
    opportunityForActor: async () => opportunity(),
    applicantProfileForActor: async () => applicant({ tenantId: 'tenant-b' }),
  });
  const result = await api.handle({ opportunityId: 'opp-1', countyId: 'county:36001' }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 403);
  assert.match(result.body.error, /authorization failed/i);
});

test('missing opportunity is 404 and provider failure is sanitized', async () => {
  const missing = createCBCAPFundingApi({
    opportunityForActor: async () => null,
    applicantProfileForActor: async () => applicant(),
  });
  assert.equal((await missing.handle({ opportunityId: 'missing', countyId: 'county:36001' }, { workspaceActor: actor() })).statusCode, 404);

  const failed = createCBCAPFundingApi({
    opportunityForActor: async () => { throw new Error('secret backend detail'); },
    applicantProfileForActor: async () => applicant(),
  });
  const result = await failed.handle({ opportunityId: 'opp-1', countyId: 'county:36001' }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.stringify(result.body).includes('secret backend detail'), false);
});

test('governance-blocked funding evaluation returns 422 without authority escalation', async () => {
  const unreviewed = opportunity();
  unreviewed.reviewStatus = 'provisional';
  const api = createCBCAPFundingApi({
    opportunityForActor: async () => unreviewed,
    applicantProfileForActor: async () => applicant(),
  });
  const result = await api.handle({ opportunityId: 'opp-1', countyId: 'county:36001', asOf: '2026-08-23' }, { workspaceActor: actor() });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.status, 'blocked');
  assert.equal(result.body.awardPredictionProduced, false);
  assert.equal(result.body.fundingAllocationProduced, false);
});
