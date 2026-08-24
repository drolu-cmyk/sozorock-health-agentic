const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateProportionalRange, createGovernedScenarioHandler, MODEL_ID } = require('../packages/cbcap/governed-scenarios');

function evidence(overrides = {}) {
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'snapshot:scenario-test',
    releaseHash: `sha256:${'a'.repeat(64)}`,
    package: {
      measures: [{
        id: 'observation:access',
        numeric_value: 10,
        review_status: 'verified',
        data_period_start: '2024-01-01',
        data_period_end: '2024-12-31',
        geography: {
          id: 'county:36001',
          kind: 'county',
          county_fips: '36001',
          display_name: 'Albany County, New York',
          review_status: 'verified',
        },
        semantics: {
          id: 'measure:access',
          source_measure_id: 'ACCESS',
          name: 'Adults with access barrier',
          unit: 'percent',
          universe: 'Adults',
          review_status: 'verified',
        },
        source_version: { source_version_id: 'source:1', review_status: 'verified' },
      }],
      ...overrides,
    },
  };
}

function assumptions(overrides = {}) {
  return {
    scenarioModelId: { source: 'user', value: MODEL_ID },
    baselineSourceMeasureId: { source: 'user', value: 'ACCESS' },
    relativeChangePctLow: { source: 'user', value: -10 },
    relativeChangePctHigh: { source: 'user', value: 20 },
    ...overrides,
  };
}

test('scenario returns a range with exact evidence release, visible formula, and no prediction claim', () => {
  const result = evaluateProportionalRange({ evidence: evidence(), assumptions: assumptions() });
  assert.equal(result.status, 'modeled_planning_range');
  assert.deepEqual(result.range, { low: 9, high: 12, unit: 'percent' });
  assert.equal(result.evidenceRelease.releaseId, 'snapshot:scenario-test');
  assert.equal(result.model.evaluationStatus, 'not_backtested');
  assert.equal(result.model.predictionClaim, false);
  assert.equal(result.uncertainty.probabilityDistribution, null);
  assert.equal(result.humanReviewRequired, true);
  assert.match(result.formula.low, /baseline/);
  assert.match(result.caveats.join(' '), /not a prediction or forecast/i);
});

test('scenario requires explicit user provenance on every assumption', () => {
  assert.throws(() => evaluateProportionalRange({ evidence: evidence(), assumptions: assumptions({ relativeChangePctLow: { source: 'system', value: -10 } }) }), /source=user/);
});

test('unknown model and invalid ranges fail closed', () => {
  assert.throws(() => evaluateProportionalRange({ evidence: evidence(), assumptions: assumptions({ scenarioModelId: { source: 'user', value: 'magic_model' } }) }), /Unsupported governed scenario model/);
  assert.throws(() => evaluateProportionalRange({ evidence: evidence(), assumptions: assumptions({ relativeChangePctLow: { source: 'user', value: 30 }, relativeChangePctHigh: { source: 'user', value: 20 } }) }), /cannot exceed/);
  assert.throws(() => evaluateProportionalRange({ evidence: evidence(), assumptions: assumptions({ relativeChangePctHigh: { source: 'user', value: 501 } }) }), /outside the reviewed model bounds/);
});

test('scenario baseline must be exactly one verified county measure', () => {
  const unverified = evidence();
  unverified.package.measures[0].review_status = 'provisional';
  assert.throws(() => evaluateProportionalRange({ evidence: unverified, assumptions: assumptions() }), /exactly one verified county measure/);

  const duplicate = evidence();
  duplicate.package.measures.push(structuredClone(duplicate.package.measures[0]));
  assert.throws(() => evaluateProportionalRange({ evidence: duplicate, assumptions: assumptions() }), /exactly one verified county measure/);
});

test('scenario blocks impossible semantic range rather than clamping it', () => {
  assert.throws(() => evaluateProportionalRange({ evidence: evidence(), assumptions: assumptions({ relativeChangePctHigh: { source: 'user', value: 500 } }) }), /upper bound/);
});

test('governed handler supports state-style graph invocation', async () => {
  const handler = createGovernedScenarioHandler();
  const result = await handler({ evidence: evidence(), assumptions: assumptions() });
  assert.equal(result.contract, 'cbcap.scenario.v1');
});
