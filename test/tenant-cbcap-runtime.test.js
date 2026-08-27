const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryRunMemory } = require('../packages/runtime/memory');
const { createTenantCBCAPRuntimeFactory } = require('../server/tenant-cbcap-runtime');

const RELEASE_HASH = `sha256:${'f'.repeat(64)}`;

function actor(tenantId) {
  return {
    tenantId,
    principalId: `${tenantId}-planner`,
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: `${tenantId} Planner`,
  };
}

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
    releaseId: 'release-tenant-test',
    releaseHash: RELEASE_HASH,
    countyFips: '36001',
    sourceVersions: [sourceVersion],
    metricSemantics: [semantics],
    measures: [measure],
    sourceCoverage: [],
    package: {
      contract_version: 'sozorock.evidence-gateway.v1',
      release_id: 'release-tenant-test',
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

test('tenant runtime factory reuses tenant memory across plan and review without cross-tenant access', async () => {
  const memories = new Map();
  let evidenceCalls = 0;
  let publishCalls = 0;
  const runtimeForActor = createTenantCBCAPRuntimeFactory({
    memoryForActor(resolvedActor) {
      if (!memories.has(resolvedActor.tenantId)) memories.set(resolvedActor.tenantId, new InMemoryRunMemory());
      return memories.get(resolvedActor.tenantId);
    },
    evidenceClientForActor() {
      return {
        async getCountyPackage(fips) {
          evidenceCalls += 1;
          assert.equal(fips, '36001');
          return structuredClone(evidencePackage());
        },
      };
    },
    publishHandlerForActor(resolvedActor) {
      return async (state) => {
        publishCalls += 1;
        return {
          status: 'approved_artifact',
          tenantId: resolvedActor.tenantId,
          runId: state.runId,
        };
      };
    },
    clock: () => '2026-08-24T01:00:00.000Z',
  });

  const tenantA = actor('tenant-a');
  const firstRuntime = await runtimeForActor(tenantA);
  const draft = await firstRuntime.planningApi.handle({ location: '36001' });
  assert.equal(draft.statusCode, 202);
  assert.equal(draft.body.status, 'awaiting_human_review');
  assert.equal(draft.body.tenantId, 'tenant-a');
  assert.equal(evidenceCalls, 1);

  const secondRuntime = await runtimeForActor(tenantA);
  const approved = await secondRuntime.reviewApi.handle(
    draft.body.runId,
    { decision: 'approve' },
    { workspaceActor: tenantA },
  );
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.status, 'approved_output');
  assert.equal(approved.body.output.tenantId, 'tenant-a');
  assert.equal(evidenceCalls, 1);
  assert.equal(publishCalls, 1);

  const tenantB = actor('tenant-b');
  const tenantBRuntime = await runtimeForActor(tenantB);
  const crossTenant = await tenantBRuntime.reviewApi.handle(
    draft.body.runId,
    { decision: 'approve' },
    { workspaceActor: tenantB },
  );
  assert.equal(crossTenant.statusCode, 404);
  assert.equal(publishCalls, 1);
});

test('tenant runtime without publish handler creates no review API', async () => {
  const runtimeForActor = createTenantCBCAPRuntimeFactory({
    memoryForActor: () => new InMemoryRunMemory(),
    evidenceClientForActor: () => ({ async getCountyPackage() { return structuredClone(evidencePackage()); } }),
  });
  const runtime = await runtimeForActor(actor('tenant-a'));
  assert.equal(runtime.reviewApi, null);
});

test('tenant runtime resolves bounded agent assistance only after actor scope is established', async () => {
  let resolvedTenant = null;
  const runtimeForActor = createTenantCBCAPRuntimeFactory({
    memoryForActor: () => new InMemoryRunMemory(),
    evidenceClientForActor: () => ({ async getCountyPackage() { return structuredClone(evidencePackage()); } }),
    agentOrchestratorForActor(resolvedActor) {
      resolvedTenant = resolvedActor.tenantId;
      return {
        async run() {
          return {
            contract: 'cbcap.agent-run.v1',
            promptVersion: 'prompt-v1',
            model: 'reviewed-model',
            synthesis: {},
            brief: {},
            trace: { toolCalls: ['synthesize_governed_evidence', 'draft_reviewable_planning_brief'] },
          };
        },
      };
    },
  });

  const runtime = await runtimeForActor(actor('tenant-a'));
  assert.equal(resolvedTenant, 'tenant-a');
  assert.equal(runtime.agentAssistanceEnabled, true);
  const result = await runtime.planningApi.handle({ location: '36001' });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.draft.agentAssistance.contract, 'cbcap.agent-run.v1');
});

test('tenant runtime exposes workforce analysis through the same actor-scoped governed evidence client', async () => {
  const seen = [];
  const runtimeForActor = createTenantCBCAPRuntimeFactory({
    memoryForActor: () => new InMemoryRunMemory(),
    evidenceClientForActor(resolvedActor) {
      assert.equal(resolvedActor.tenantId, 'tenant-a');
      return {
        async getCountyPackage(fips) {
          seen.push(fips);
          return structuredClone(evidencePackage());
        },
      };
    },
  });

  const tenantActor = actor('tenant-a');
  const runtime = await runtimeForActor(tenantActor);
  assert.equal(runtime.workforceCapacityEnabled, true);
  const result = await runtime.workforceApi.handle({ countyFips: '36001' }, { workspaceActor: tenantActor });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.contract, 'cbcap.workforce-capacity.v1');
  assert.equal(result.body.evidenceState, 'no_verified_data');
  assert.deepEqual(seen, ['36001']);
});
