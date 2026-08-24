const test = require('node:test');
const assert = require('node:assert/strict');
const { CBCAPPlanningEngine } = require('../packages/cbcap/planning-engine');
const { InMemoryRunMemory } = require('../packages/runtime/memory');

const RELEASE_HASH = `sha256:${'e'.repeat(64)}`;

function evidencePackage() {
  const semantics = {
    id: 'measure-lacktrpt-crude',
    source_measure_id: 'LACKTRPT:Crude',
    name: 'Lack of reliable transportation',
    description: 'Governed test measure',
    direction: 'adverse',
    higher_value_meaning: 'adverse',
    unit: 'percent',
    universe: 'Adults',
    adjustment: 'crude',
    comparison_policy: 'higher_is_concern',
    trendable: false,
    forecastable: false,
    aggregatable: false,
    allowed_geography_kinds: ['county'],
    allowed_visualizations: ['choropleth'],
    review_status: 'verified',
  };
  const geography = {
    id: 'county:36001',
    kind: 'county',
    authority: 'census',
    authority_id: '36001',
    name: 'Albany County',
    display_name: 'Albany County, New York',
    state_fips: '36',
    county_fips: '36001',
    vintage: '2025',
    valid_from: null,
    valid_to: null,
    review_status: 'verified',
    caveat: null,
  };
  const sourceVersion = {
    source_id: 'cdc-places',
    source_version_id: 'places-2025',
    publisher: 'Centers for Disease Control and Prevention',
    title: 'PLACES 2025',
    official_url: 'https://data.cdc.gov/',
    release_label: '2025',
    release_date: '2025-12-04',
    data_period_start: '2023-01-01',
    data_period_end: '2023-12-31',
    retrieved_at: '2026-08-23T00:00:00Z',
    stale_after: null,
    content_hash: 'sha256:test',
    schema_version: '1',
    review_status: 'verified',
  };
  const measure = {
    id: 'obs-lacktrpt-crude',
    semantics,
    geography,
    source_version: sourceVersion,
    geography_level: 'county',
    value: 8.4,
    numeric_value: 8.4,
    confidence_low: 7.4,
    confidence_high: 9.4,
    margin_of_error: null,
    data_period_start: '2023-01-01',
    data_period_end: '2023-12-31',
    source_metadata: {},
    review_status: 'verified',
  };
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'release-2026-08-23',
    releaseHash: RELEASE_HASH,
    countyFips: '36001',
    sourceVersions: [sourceVersion],
    metricSemantics: [semantics],
    measures: [measure],
    sourceCoverage: [],
    package: {
      contract_version: 'sozorock.evidence-gateway.v1',
      release_id: 'release-2026-08-23',
      generated_at: '2026-08-23T00:00:00Z',
      geographies: [geography],
      geography_relationships: [],
      metric_semantics: [semantics],
      measures: [measure],
      source_versions: [sourceVersion],
      source_coverage: [],
    },
  };
}

test('planning engine review resumes exact saved run without fetching evidence twice', async () => {
  const memory = new InMemoryRunMemory();
  let evidenceCalls = 0;
  let publishCalls = 0;
  const engine = new CBCAPPlanningEngine({
    tenantId: 'tenant-a',
    memory,
    evidenceClient: {
      async getCountyPackage(fips) {
        evidenceCalls += 1;
        assert.equal(fips, '36001');
        return structuredClone(evidencePackage());
      },
    },
    publishHandler: async (state) => {
      publishCalls += 1;
      return {
        status: 'approved_artifact',
        runId: state.runId,
        evidenceReleaseId: state.evidence.releaseId,
      };
    },
  });

  const draft = await engine.buildCountyPlan('36001');
  assert.equal(draft.status, 'awaiting_human_review');
  assert.equal(draft.meta.resumableReview, true);
  assert.equal(evidenceCalls, 1);
  assert.equal(publishCalls, 0);

  const checkpoint = await engine.getRunReviewCheckpoint(draft.runId);
  assert.equal(checkpoint.tenantId, 'tenant-a');
  assert.equal(checkpoint.status, 'awaiting_human_review');
  assert.equal(checkpoint.resumeAt, 'publish');
  assert.equal(checkpoint.evidenceReleaseId, 'release-2026-08-23');

  const result = await engine.resumeCountyPlan(draft.runId, {
    status: 'approved',
    decision: 'approve',
    by: 'reviewer-subject-1',
    scope: 'county_plan',
    reviewedAt: '2026-08-24T00:30:00.000Z',
    objectId: draft.runId,
    evidenceReleaseId: checkpoint.evidenceReleaseId,
  });

  assert.equal(result.status, 'approved_output');
  assert.equal(result.output.status, 'approved_artifact');
  assert.equal(result.output.runId, draft.runId);
  assert.equal(evidenceCalls, 1);
  assert.equal(publishCalls, 1);
  assert.equal(result.meta.humanReviewRequired, false);
  assert.equal(result.meta.resumableReview, false);
});

test('planning engine without publish capability creates a non-resumable review checkpoint', async () => {
  const engine = new CBCAPPlanningEngine({
    tenantId: 'tenant-a',
    memory: new InMemoryRunMemory(),
    evidenceClient: { async getCountyPackage() { return structuredClone(evidencePackage()); } },
  });
  const draft = await engine.buildCountyPlan('36001');
  const checkpoint = await engine.getRunReviewCheckpoint(draft.runId);
  assert.equal(draft.meta.resumableReview, false);
  assert.equal(checkpoint.status, 'awaiting_human_review');
  assert.equal(checkpoint.resumeAt, null);
  await assert.rejects(
    () => engine.resumeCountyPlan(draft.runId, {}),
    /No reviewed publish capability/,
  );
});
