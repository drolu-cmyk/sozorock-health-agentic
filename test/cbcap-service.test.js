const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPService } = require('../packages/cbcap/governed-service');

const HASH = `sha256:${'d'.repeat(64)}`;

function evidence() {
  const barrier = {
    id: 'obs-transport',
    value: 14.2,
    numeric_value: 14.2,
    confidence_low: 13.1,
    confidence_high: 15.3,
    margin_of_error: null,
    data_period_start: '2023-01-01',
    data_period_end: '2023-12-31',
    review_status: 'verified',
    semantics: {
      id: 'measure-transport',
      source_measure_id: 'LACKTRPT:Crude',
      name: 'Lack of reliable transportation',
      description: 'Published CDC PLACES measure',
      direction: 'adverse',
      higher_value_meaning: 'More adults reporting the barrier',
      unit: 'percent',
    },
    source_version: { source_version_id: 'places-2025' },
  };
  const condition = {
    id: 'obs-diabetes',
    value: 10.1,
    numeric_value: 10.1,
    review_status: 'verified',
    semantics: {
      id: 'measure-diabetes',
      source_measure_id: 'DIABETES:Crude',
      name: 'Diagnosed diabetes',
      direction: 'adverse',
      unit: 'percent',
    },
    source_version: { source_version_id: 'places-2025' },
  };
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'release-1',
    releaseHash: HASH,
    countyFips: '36001',
    sourceVersions: [{ source_version_id: 'places-2025' }],
    metricSemantics: [barrier.semantics, condition.semantics],
    measures: [barrier, condition],
    sourceCoverage: [
      {
        source_id: 'cdc-places',
        status: 'complete_with_records',
        records_matched: 2,
        caveat: null,
      },
      {
        source_id: 'local-planning-documents',
        status: 'unavailable',
        records_matched: 0,
        caveat: 'Current local planning evidence is not yet verified.',
      },
    ],
  };
}

function service(options = {}) {
  let evidenceCalls = 0;
  const geographyAgent = options.geographyAgent || {
    async resolve() {
      return {
        fips: '36001',
        county: 'Albany County',
        state: 'NY',
        multiCounty: false,
        resolvedAs: 'fips',
      };
    },
  };
  const evidenceClient = {
    async getCountyPackage() {
      evidenceCalls += 1;
      return evidence();
    },
  };
  return {
    instance: createCBCAPService({ geographyAgent, evidenceClient, clock: () => '2026-08-24T00:00:00.000Z' }),
    evidenceCalls: () => evidenceCalls,
  };
}

test('service returns a review draft without synthetic planning scores', async () => {
  const { instance } = service();
  const result = await instance.handle({ location: '36001' });

  assert.equal(result.statusCode, 202);
  assert.equal(result.body.status, 'awaiting_human_review');
  assert.equal(result.body.barriers.findings.length, 1);
  assert.equal(result.body.barriers.findings[0].domain, 'transportation');
  assert.equal(result.body.barriers.unclassifiedMeasureCount, 1);
  assert.equal(result.body.planning.localPriorityStatus, 'not_established');
  assert.equal(result.body.planning.decisionBoundary.canDeclareCountyPriority, false);
  assert.equal(result.body.scenario, undefined);
  assert.equal('planningAttention' in result.body, false);
  assert.equal('recommendedHubMix' in result.body, false);
  assert.equal('heatPoints' in result.body, false);
});

test('service records arithmetic scenario output only from explicit user assumptions', async () => {
  const { instance } = service();
  const result = await instance.handle({
    location: '36001',
    assumptions: {
      reachablePopulation: { source: 'user', value: 1000 },
      uptakeRate: { source: 'user', value: 0.12 },
      months: { source: 'user', value: 12 },
    },
  });

  assert.equal(result.statusCode, 202);
  assert.equal(result.body.scenario.outputs.length, 1);
  assert.equal(result.body.scenario.outputs[0].value, 120);
  assert.equal(result.body.scenario.outputs[0].formula, 'reachablePopulation × uptakeRate');
  assert.match(result.body.scenario.limitations.join(' '), /not forecasts/i);
});

test('service rejects incomplete approval records', async () => {
  const { instance } = service();
  const result = await instance.handle({
    location: '36001',
    approval: { status: 'approved', by: 'reviewer-1', scope: 'county_plan' },
  });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /reviewedAt/);
});

test('service returns approved output with no external publication side effect', async () => {
  const { instance } = service();
  const result = await instance.handle({
    location: '36001',
    approval: {
      status: 'approved',
      by: 'reviewer-1',
      scope: 'county_plan',
      reviewedAt: '2026-08-24T00:01:00.000Z',
    },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'approved_output');
  assert.equal(result.body.output.externalPublicationExecuted, false);
  assert.equal(result.body.output.approvedBy, 'reviewer-1');
});

test('multi-county ZIP selection halts before Evidence Gateway access', async () => {
  const { instance, evidenceCalls } = service({
    geographyAgent: {
      async resolve() {
        return {
          fips: '36001',
          county: 'Albany County',
          state: 'NY',
          multiCounty: true,
          allCounties: [
            { fips: '36001', name: 'Albany County', resRatio: 0.6 },
            { fips: '36093', name: 'Schenectady County', resRatio: 0.4 },
          ],
          resolvedAs: 'zip',
        };
      },
    },
  });
  const result = await instance.handle({ location: '12345' });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.status, 'needs_place_selection');
  assert.equal(result.body.place.kind, 'multi_county_zip');
  assert.equal(evidenceCalls(), 0);
});
