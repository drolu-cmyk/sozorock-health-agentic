const test = require('node:test');
const assert = require('node:assert/strict');
const { createGovernedScenarioHandler } = require('../packages/cbcap/scenario-governance');

const RELEASE_HASH = `sha256:${'a'.repeat(64)}`;

function registration(overrides = {}) {
  return {
    id: 'scenario-reg-1',
    assumptionKey: 'testRateChange',
    inputSourceMeasureId: 'TEST_RATE:Crude',
    outputKey: 'test_rate',
    outputLabel: 'Test rate',
    method: 'relative_percent',
    modelVersion: 'deterministic-rate-sensitivity-v1',
    methodVersion: 'relative-percent-v1',
    assumptionUnit: 'percent_change',
    allowedSourceIds: ['test-official'],
    maximumHorizonDays: 730,
    reviewStatus: 'verified',
    approvedBy: 'foundation-reviewer-1',
    approvedAt: '2026-08-01',
    ...overrides,
  };
}

function state(overrides = {}) {
  const measure = {
    id: 'obs-test-rate',
    semantics: {
      id: 'measure-test-rate',
      source_measure_id: 'TEST_RATE:Crude',
      name: 'Test rate',
      unit: 'percent',
      forecastable: true,
      review_status: 'verified',
    },
    geography: {
      id: 'county:36001',
      kind: 'county',
      county_fips: '36001',
      review_status: 'verified',
    },
    source_version: {
      source_id: 'test-official',
      source_version_id: 'test-2026',
      release_date: '2026-01-15',
      data_period_start: '2025-01-01',
      data_period_end: '2025-12-31',
      retrieved_at: '2026-01-15T00:00:00.000Z',
      review_status: 'verified',
    },
    numeric_value: 20,
    data_period_start: '2025-01-01',
    data_period_end: '2025-12-31',
    review_status: 'verified',
  };
  return {
    task: {
      countyFips: '36001',
      scenario: { asOf: '2026-08-23', horizonEnd: '2027-08-23' },
    },
    place: { countyFips: '36001' },
    evidence: {
      releaseId: 'release-2026-08-23',
      releaseHash: RELEASE_HASH,
      package: { measures: [measure] },
    },
    ...overrides,
  };
}

function assumptions(overrides = {}) {
  return {
    testRateChange: {
      source: 'user',
      value: -10,
      unit: 'percent_change',
      range: { low: -15, high: -5 },
      rationale: 'Planning sensitivity only',
      ...overrides,
    },
  };
}

test('governed scenario produces bounded deterministic sensitivity from reviewed registration and evidence', async () => {
  const handler = createGovernedScenarioHandler({
    registrations: [registration()],
    clock: () => new Date('2026-08-23T12:00:00.000Z'),
  });
  const result = await handler(state(), assumptions());

  assert.equal(result.contract, 'cbcap.scenario.v1');
  assert.equal(result.status, 'scenario_output');
  assert.equal(result.evaluationStatus, 'ready');
  assert.equal(result.scenarioType, 'deterministic_planning_sensitivity');
  assert.equal(result.evidenceState, 'scenario_output');
  assert.deepEqual(result.evidenceRelease, {
    releaseId: 'release-2026-08-23',
    releaseHash: RELEASE_HASH,
  });
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0].value, 18);
  assert.deepEqual(result.outputs[0].range, { low: 17, high: 19 });
  assert.equal(result.outputs[0].unit, 'percent');
  assert.equal(result.evaluations[0].model.formula, 'baseline * (1 + user_assumption / 100)');
  assert.equal(result.evaluations[0].model.modelVersion, 'deterministic-rate-sensitivity-v1');
  assert.equal(result.evaluations[0].baseline.sourceId, 'test-official');
  assert.equal(result.officialEstimate, false);
  assert.equal(result.statisticalPrediction, false);
  assert.equal(result.probabilityOfOccurrence, null);
  assert.equal(result.humanReviewRequired, true);
  assert.match(result.limitations.join(' '), /not a statistical prediction/i);
});

test('scenario blocks when user assumption omits an explicit range', async () => {
  const handler = createGovernedScenarioHandler({ registrations: [registration()] });
  const input = assumptions();
  delete input.testRateChange.range;
  const result = await handler(state(), input);

  assert.equal(result.evaluationStatus, 'blocked');
  assert.deepEqual(result.outputs, []);
  assert.ok(result.reasonCodes.includes('assumption_range_required'));
});

test('scenario blocks unregistered assumption keys rather than executing client-defined formulas', async () => {
  const handler = createGovernedScenarioHandler({ registrations: [registration()] });
  const result = await handler(state(), {
    arbitraryClientFormula: {
      source: 'user',
      value: 999,
      unit: 'percent_change',
      range: { low: 998, high: 1000 },
    },
  });

  assert.equal(result.evaluationStatus, 'blocked');
  assert.deepEqual(result.outputs, []);
  assert.ok(result.reasonCodes.includes('assumption_not_registered'));
});

test('scenario blocks when the verified baseline is not forecastable', async () => {
  const inputState = state();
  inputState.evidence.package.measures[0].semantics.forecastable = false;
  const handler = createGovernedScenarioHandler({ registrations: [registration()] });
  const result = await handler(inputState, assumptions());

  assert.equal(result.evaluationStatus, 'blocked');
  assert.deepEqual(result.outputs, []);
  assert.ok(result.reasonCodes.includes('verified_forecastable_baseline_unavailable'));
});

test('scenario blocks source mismatch and horizons beyond the reviewed model limit', async () => {
  const inputState = state();
  inputState.task.scenario.horizonEnd = '2029-08-23';
  const handler = createGovernedScenarioHandler({
    registrations: [registration({ allowedSourceIds: ['different-official-source'] })],
  });
  const result = await handler(inputState, assumptions());

  assert.equal(result.evaluationStatus, 'blocked');
  assert.deepEqual(result.outputs, []);
  assert.ok(result.reasonCodes.includes('baseline_source_not_registered'));
  assert.ok(result.reasonCodes.includes('scenario_horizon_exceeds_model'));
});

test('scenario blocks outputs outside a bounded percent domain', async () => {
  const handler = createGovernedScenarioHandler({
    registrations: [registration({ method: 'absolute_change', assumptionUnit: 'percent' })],
  });
  const result = await handler(state(), {
    testRateChange: {
      source: 'user',
      value: 90,
      unit: 'percent',
      range: { low: 80, high: 100 },
    },
  });

  assert.equal(result.evaluationStatus, 'blocked');
  assert.deepEqual(result.outputs, []);
  assert.deepEqual(result.reasonCodes, ['scenario_result_outside_metric_domain']);
});

test('scenario blocks unreviewed model registration without emitting partial output', async () => {
  const handler = createGovernedScenarioHandler({
    registrations: [registration({ reviewStatus: 'provisional' })],
  });
  const result = await handler(state(), assumptions());

  assert.equal(result.evaluationStatus, 'blocked');
  assert.deepEqual(result.outputs, []);
  assert.ok(result.reasonCodes.includes('scenario_model_not_verified'));
});
