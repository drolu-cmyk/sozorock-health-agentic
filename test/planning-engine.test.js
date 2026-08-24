const test = require('node:test');
const assert = require('node:assert/strict');
const { CBCAPPlanningEngine } = require('../packages/cbcap/planning-engine');

const RELEASE_HASH = `sha256:${'d'.repeat(64)}`;
const COUNTY = {
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

function sourceVersion(id = 'places-2025') {
  return {
    source_id: 'cdc-places',
    source_version_id: id,
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
}

function measure(sourceMeasureId, value, options = {}) {
  const id = sourceMeasureId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const contextual = options.contextual === true;
  const reviewStatus = options.reviewStatus || 'verified';
  return {
    id: `obs-${id}`,
    semantics: {
      id: `measure-${id}`,
      source_measure_id: sourceMeasureId,
      name: options.name || sourceMeasureId,
      description: 'Governed test measure',
      direction: contextual ? 'contextual' : 'adverse',
      higher_value_meaning: contextual ? 'context_dependent' : 'adverse',
      unit: 'percent',
      universe: 'Adults',
      adjustment: 'crude',
      comparison_policy: contextual ? 'context_only' : 'higher_is_concern',
      trendable: false,
      forecastable: false,
      aggregatable: false,
      allowed_geography_kinds: ['county'],
      allowed_visualizations: ['choropleth'],
      review_status: 'verified',
    },
    geography: { ...COUNTY },
    source_version: sourceVersion(),
    geography_level: 'county',
    value,
    numeric_value: value,
    confidence_low: options.low ?? value - 1,
    confidence_high: options.high ?? value + 1,
    margin_of_error: null,
    data_period_start: '2023-01-01',
    data_period_end: '2023-12-31',
    source_metadata: {},
    review_status: reviewStatus,
  };
}

function evidencePackage(overrides = {}) {
  const measures = overrides.measures || [
    measure('ACCESS2:Crude', 6.2, { name: 'Adults without health insurance' }),
    measure('LACKTRPT:Crude', 8.4, { name: 'Lack of reliable transportation' }),
    measure('DISABILITY:Crude', 14.1, { name: 'Any disability', contextual: true }),
    measure('UNREVIEWED:Crude', 99.9, { name: 'Unreviewed metric' }),
  ];
  const semantics = measures.map((item) => item.semantics);
  const versions = [sourceVersion()];
  const coverage = [];
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'release-2026-08-23',
    releaseHash: RELEASE_HASH,
    countyFips: '36001',
    sourceVersions: versions,
    metricSemantics: semantics,
    measures,
    sourceCoverage: coverage,
    package: {
      contract_version: 'sozorock.evidence-gateway.v1',
      release_id: 'release-2026-08-23',
      generated_at: '2026-08-23T00:00:00Z',
      geographies: [{ ...COUNTY }],
      geography_relationships: [],
      metric_semantics: semantics,
      measures,
      source_versions: versions,
      source_coverage: coverage,
    },
  };
}

function engineFor(evidence, options = {}) {
  const calls = { evidence: 0 };
  const engine = new CBCAPPlanningEngine({
    ...options,
    evidenceClient: {
      async getCountyPackage(fips) {
        calls.evidence += 1;
        assert.equal(fips, '36001');
        return structuredClone(evidence);
      },
    },
  });
  return { engine, calls };
}

test('governed planning requires exact county FIPS before evidence access', async () => {
  const { engine, calls } = engineFor(evidencePackage());
  const result = await engine.buildCountyPlan('Albany County, NY');
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'county_fips_required');
  assert.equal(calls.evidence, 0);
});

test('governed planning uses reviewed Evidence Gateway barriers without synthetic scores', async () => {
  const { engine } = engineFor(evidencePackage());
  const result = await engine.buildCountyPlan('36001');

  assert.equal(result.status, 'awaiting_human_review');
  assert.equal(result.error.code, 'human_review_required');
  assert.equal(result.evidence.releaseId, 'release-2026-08-23');
  assert.equal(result.evidence.releaseHash, RELEASE_HASH);
  assert.equal(result.barriers.pathwayBarriers.insurance.status, 'published_public_estimate');
  assert.equal(result.barriers.pathwayBarriers.insurance.value, 6.2);
  assert.equal(result.barriers.pathwayBarriers.transportation.value, 8.4);
  assert.equal(result.barriers.pathwayBarriers.food_insecurity.status, 'no_verified_data');
  assert.equal(result.barriers.accessibilityContext.disability.status, 'published_public_estimate');
  assert.equal(result.barriers.accessibilityContext.disability.value, 14.1);
  assert.equal(result.barriers.composite, null);
  assert.equal(result.barriers.ranking, null);

  assert.deepEqual(
    result.planning.capacityContext.map((item) => item.status),
    ['planned_governed_feed', 'planned_governed_feed', 'planned_governed_feed'],
  );
  assert.equal(result.planning.fundingIntelligence.status, 'not_evaluated');
  assert.equal(result.draft.status, 'draft_requires_human_review');

  const derived = JSON.stringify({
    barriers: result.barriers,
    planning: result.planning,
    draft: result.draft,
    scenario: result.scenario,
    output: result.output,
  });
  for (const prohibited of ['heatPoints', 'planningAttention', 'recommendedHubMix', 'projectedReach', 'barrierReduction', 'costIndex']) {
    assert.equal(derived.includes(prohibited), false, `${prohibited} must not be produced`);
  }
  assert.equal(derived.includes('UNREVIEWED:Crude'), false, 'unreviewed metrics must not become derived planning evidence');
  assert.equal(JSON.stringify(result.evidence).includes('UNREVIEWED:Crude'), true, 'raw governed evidence remains available for audit');
});

test('provisional barrier evidence remains no verified data', async () => {
  const evidence = evidencePackage({
    measures: [
      measure('ACCESS2:Crude', 6.2),
      measure('LACKTRPT:Crude', 8.4, { reviewStatus: 'provisional' }),
    ],
  });
  const { engine } = engineFor(evidence);
  const result = await engine.buildCountyPlan('36001');
  assert.equal(result.barriers.pathwayBarriers.insurance.status, 'published_public_estimate');
  assert.equal(result.barriers.pathwayBarriers.transportation.status, 'no_verified_data');
});

test('user assumptions do not create a scenario without a reviewed scenario handler', async () => {
  const { engine } = engineFor(evidencePackage());
  const result = await engine.buildCountyPlan({
    countyFips: '36001',
    assumptions: {
      annualPopulationChange: { source: 'user', value: 0.5 },
    },
  });
  assert.equal(result.status, 'awaiting_human_review');
  assert.equal(result.scenario, undefined);
});

test('a reviewed scenario handler runs only from explicit user assumptions', async () => {
  let scenarioCalls = 0;
  const { engine } = engineFor(evidencePackage(), {
    scenarioHandler: async (_state, assumptions) => {
      scenarioCalls += 1;
      return {
        status: 'scenario_output',
        formula: 'test sensitivity formula',
        assumptions,
        limitations: ['Planning sensitivity only'],
      };
    },
  });

  const withoutAssumptions = await engine.buildCountyPlan('36001');
  assert.equal(withoutAssumptions.scenario, undefined);
  assert.equal(scenarioCalls, 0);

  const withAssumptions = await engine.buildCountyPlan({
    countyFips: '36001',
    assumptions: {
      annualPopulationChange: { source: 'user', value: 0.5 },
    },
  });
  assert.equal(scenarioCalls, 1);
  assert.equal(withAssumptions.scenario.status, 'scenario_output');
  assert.equal(withAssumptions.status, 'awaiting_human_review');
});

test('an approval record cannot publish unless an explicit publish capability is installed', async () => {
  const { engine } = engineFor(evidencePackage());
  const result = await engine.buildCountyPlan({
    countyFips: '36001',
    approval: { status: 'approved', by: 'reviewer-1' },
  });
  assert.equal(result.status, 'awaiting_human_review');
  assert.equal(result.output, undefined);
});
