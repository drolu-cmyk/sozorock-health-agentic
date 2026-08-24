const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateFundingFit } = require('../packages/cbcap/funding-intelligence');

function opportunity(overrides = {}) {
  return {
    id: 'opp-1',
    title: 'County access implementation grant',
    reviewStatus: 'verified',
    openDate: '2026-08-01',
    closeDate: '2026-10-31',
    source: {
      sourceId: 'funding-source-1',
      publisher: 'Public Funder',
      officialUrl: 'https://funder.example/opportunity',
      retrievedAt: '2026-08-20T00:00:00Z',
      reviewStatus: 'verified',
      sourceClaimIds: ['funding-claim:notice'],
    },
    criteria: [
      {
        id: 'criterion:applicant',
        type: 'applicant_type',
        description: 'Eligible applicant class',
        acceptedValues: ['county_government'],
        sourceClaimIds: ['funding-claim:applicant'],
      },
      {
        id: 'criterion:geography',
        type: 'geography',
        description: 'Eligible geography',
        acceptedValues: ['county:36001'],
        sourceClaimIds: ['funding-claim:geography'],
      },
      {
        id: 'criterion:priority',
        type: 'plan_priority',
        description: 'Documented current-plan priority',
        requiredEntityIds: ['claim:priority-access'],
        sourceClaimIds: ['funding-claim:priority'],
      },
      {
        id: 'criterion:barrier',
        type: 'barrier',
        description: 'Documented access barrier',
        requiredEntityIds: ['measure:transportation'],
        sourceClaimIds: ['funding-claim:barrier'],
      },
    ],
    ...overrides,
  };
}

function applicant(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    applicantTypes: ['county_government'],
    geographyIds: ['county:36001'],
    partnerOrganizationIds: [],
    designationEvidenceIds: [],
    supportingEvidenceIds: [],
    planPriorityClaimIds: ['claim:priority-access'],
    barrierEvidenceIds: ['measure:transportation'],
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluateFundingFit({
    opportunity: opportunity(overrides.opportunity),
    applicant: applicant(overrides.applicant),
    countyId: overrides.countyId || 'county:36001',
    stateId: 'state:36',
    asOf: overrides.asOf || '2026-08-23',
  });
}

test('verified requirements may produce strong evidence fit without asserting eligibility or award likelihood', () => {
  const result = evaluate();
  assert.equal(result.status, 'provisional_review_required');
  assert.equal(result.requirementsStatus, 'matched');
  assert.equal(result.fitStatus, 'strong_evidence_fit');
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.finalEligibilityAuthority, 'funder_and_authorized_humans');
  assert.equal(result.awardPredictionProduced, false);
  assert.equal(result.fundingAllocationProduced, false);
  const serialized = JSON.stringify(result).toLowerCase();
  assert.equal(serialized.includes('likely_eligible'), false);
  assert.equal(serialized.includes('award probability'), false);
});

test('unverified opportunity source blocks funding reasoning', () => {
  const result = evaluate({ opportunity: { reviewStatus: 'provisional' } });
  assert.equal(result.status, 'blocked');
  assert.equal(result.requirementsStatus, 'unknown');
  assert.equal(result.fitStatus, 'not_evaluated');
  assert.deepEqual(result.trajectory[0].reasonCodes, ['funding_source_not_verified']);
});

test('required criterion without source lineage blocks reasoning', () => {
  const value = opportunity();
  value.criteria[0] = { ...value.criteria[0], sourceClaimIds: [] };
  const result = evaluateFundingFit({
    opportunity: value,
    applicant: applicant(),
    countyId: 'county:36001',
    asOf: '2026-08-23',
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.trajectory[0].reasonCodes[0], 'required_criterion_missing_source_lineage');
});

test('applicant or geography mismatch is a requirement conflict, not an eligibility decision', () => {
  const result = evaluate({ applicant: { applicantTypes: ['private_company'], geographyIds: ['county:48029'] } });
  assert.equal(result.requirementsStatus, 'conflict');
  assert.equal(result.fitStatus, 'weak_evidence_fit');
  assert.ok(result.criteria.some((item) => item.type === 'applicant_type' && item.status === 'conflict'));
  assert.ok(result.criteria.some((item) => item.type === 'geography' && item.status === 'matched'), 'explicit county context remains part of the evaluation');
  assert.match(result.caveats.join(' '), /final eligibility/i);
});

test('missing partner or evidence items are surfaced explicitly', () => {
  const value = opportunity();
  value.criteria.push({
    id: 'criterion:partner',
    type: 'partner',
    description: 'Required implementation partner',
    requiredEntityIds: ['org:library'],
    sourceClaimIds: ['funding-claim:partner'],
  });
  value.criteria.push({
    id: 'criterion:evidence',
    type: 'evidence',
    description: 'Required evidence package',
    requiredEntityIds: ['evidence:local-survey'],
    sourceClaimIds: ['funding-claim:evidence'],
  });
  const result = evaluateFundingFit({
    opportunity: value,
    applicant: applicant(),
    countyId: 'county:36001',
    asOf: '2026-08-23',
  });
  assert.equal(result.requirementsStatus, 'incomplete');
  assert.deepEqual(result.missingPartnerIds, ['org:library']);
  assert.deepEqual(result.missingEvidenceIds, ['evidence:local-survey']);
});

test('closed, not-yet-open, and unknown deadlines preserve timing uncertainty', () => {
  const closed = evaluate({ asOf: '2026-11-01' });
  assert.equal(closed.status, 'closed_opportunity');
  assert.equal(closed.fitStatus, 'not_evaluated');

  const future = evaluate({ asOf: '2026-07-01' });
  assert.equal(future.deadlineStatus, 'not_yet_open');
  assert.match(future.caveats.join(' '), /not yet open/i);

  const unknown = evaluate({ opportunity: { openDate: null, closeDate: null } });
  assert.equal(unknown.deadlineStatus, 'unknown');
  assert.match(unknown.caveats.join(' '), /deadline is not verified/i);
});

test('official source must use HTTPS', () => {
  assert.throws(() => evaluate({ opportunity: { source: { ...opportunity().source, officialUrl: 'http://funder.example/opportunity' } } }), /must use https/);
});
