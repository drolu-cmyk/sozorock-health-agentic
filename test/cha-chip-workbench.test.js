const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChaChipWorkbench, PLANNING_CONTRACT } = require('../packages/cbcap/cha-chip-workbench');

const geographyId = 'county:36001';
const sourceVersionId = 'source-version:plan-1';

function evidence(overrides = {}) {
  const document = {
    id: 'document:chip-1',
    source_version_id: sourceVersionId,
    document_type: 'chip',
    title: 'Reviewed county plan',
    publisher: 'County Health Department',
    official_url: 'https://county.example/plan.pdf',
    published_at: '2026-01-01',
    period_start: '2026-01-01',
    period_end: '2029-12-31',
    geography_ids: [geographyId],
    content_hash: `sha256:${'a'.repeat(64)}`,
    page_count: 40,
    coverage_scope: 'county_specific',
    current_plan_status: 'verified_current',
    review_status: 'verified',
    reviewed_by: 'reviewer@example.org',
    reviewed_at: '2026-08-22T00:00:00Z',
  };
  const priority = {
    id: 'claim:priority-1',
    document_id: document.id,
    geography_ids: [geographyId],
    claim_type: 'priority',
    statement: 'Access to preventive services is a documented local priority.',
    extraction_method: 'human',
    confidence: 'high',
    review_status: 'verified',
    reviewed_by: 'reviewer@example.org',
    reviewed_at: '2026-08-22T00:00:00Z',
  };
  const citation = {
    id: 'citation:priority-1',
    claim_id: priority.id,
    document_id: document.id,
    source_version_id: sourceVersionId,
    page_number: 12,
    artifact_page_index: 11,
    section: 'Priorities',
    source_field: null,
    quoted_text_hash: `sha256:${'b'.repeat(64)}`,
    review_status: 'verified',
  };
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'snapshot:test-release',
    releaseHash: `sha256:${'c'.repeat(64)}`,
    package: {
      contract_version: 'sozorock.evidence-gateway.v1',
      release_id: 'snapshot:test-release',
      geographies: [{
        id: geographyId,
        kind: 'county',
        county_fips: '36001',
        display_name: 'Albany County, New York',
      }],
      source_versions: [{
        source_version_id: sourceVersionId,
        review_status: 'verified',
      }],
      planning_contract_version: PLANNING_CONTRACT,
      planning_documents: [document],
      planning_claims: [priority],
      planning_citations: [citation],
      ...overrides,
    },
  };
}

test('workbench organizes only reviewed current-plan claims with locators', () => {
  const workbench = buildChaChipWorkbench(evidence());
  assert.equal(workbench.status, 'verified_current_plan_evidence');
  assert.equal(workbench.currentDocuments.length, 1);
  assert.equal(workbench.evidenceByType.priority.length, 1);
  assert.equal(workbench.evidenceByType.priority[0].citations[0].pageNumber, 12);
  assert.equal(workbench.evidenceByType.priority[0].evidenceRelease.releaseId, 'snapshot:test-release');
  assert.equal(workbench.boundaries.officialPriorityDecision, false);
  assert.equal(workbench.boundaries.replacesOfficialChaChip, false);
  assert.equal(workbench.boundaries.humanReviewRequired, true);
});

test('provisional or non-current planning documents cannot become current workbench evidence', () => {
  const base = evidence();
  const provisional = { ...base.package.planning_documents[0], review_status: 'provisional' };
  const workbench = buildChaChipWorkbench(evidence({ planning_documents: [provisional] }));
  assert.equal(workbench.status, 'no_verified_current_plan');
  assert.deepEqual(workbench.currentDocuments, []);
  assert.equal(workbench.evidenceByType.priority, undefined);

  const historical = { ...base.package.planning_documents[0], current_plan_status: 'superseded' };
  const historicalWorkbench = buildChaChipWorkbench(evidence({ planning_documents: [historical] }));
  assert.equal(historicalWorkbench.status, 'no_verified_current_plan');
  assert.equal(historicalWorkbench.supportingDocuments.length, 1);
});

test('claim without a page or section locator is not admitted', () => {
  const base = evidence();
  const citation = {
    ...base.package.planning_citations[0],
    page_number: null,
    artifact_page_index: null,
    section: null,
    source_field: 'field-only',
  };
  const workbench = buildChaChipWorkbench(evidence({ planning_citations: [citation] }));
  assert.equal(workbench.status, 'verified_current_plan_without_cited_claims');
  assert.equal(workbench.evidenceByType.priority, undefined);
});

test('multiple verified current plans are surfaced as governance conflict rather than auto-selected', () => {
  const base = evidence();
  const second = {
    ...base.package.planning_documents[0],
    id: 'document:chip-2',
    title: 'Second reviewed current plan',
  };
  const workbench = buildChaChipWorkbench(evidence({
    planning_documents: [base.package.planning_documents[0], second],
  }));
  assert.equal(workbench.status, 'current_plan_governance_conflict');
  assert.equal(workbench.currentDocuments.length, 2);
  assert.equal(workbench.governanceConflicts[0].code, 'multiple_verified_current_plans');
});

test('missing implementation claim types are labeled evidence-record gaps, not plan omissions', () => {
  const workbench = buildChaChipWorkbench(evidence());
  const objectiveGap = workbench.evidenceRecordGaps.find((gap) => gap.claimType === 'objective');
  assert.ok(objectiveGap);
  assert.match(objectiveGap.reason, /evidence-record gap/i);
  assert.match(objectiveGap.reason, /not proof/i);
});

test('wrong geography, source mismatch, or missing planning contract fails closed', () => {
  const base = evidence();
  const wrongClaim = { ...base.package.planning_claims[0], geography_ids: ['county:36093'] };
  const wrongGeography = buildChaChipWorkbench(evidence({ planning_claims: [wrongClaim] }));
  assert.equal(wrongGeography.evidenceByType.priority, undefined);

  const wrongCitation = { ...base.package.planning_citations[0], source_version_id: 'source-version:other' };
  const wrongSource = buildChaChipWorkbench(evidence({ planning_citations: [wrongCitation] }));
  assert.equal(wrongSource.evidenceByType.priority, undefined);

  const missingContract = buildChaChipWorkbench(evidence({ planning_contract_version: undefined }));
  assert.equal(missingContract.status, 'planning_evidence_contract_unavailable');
});
