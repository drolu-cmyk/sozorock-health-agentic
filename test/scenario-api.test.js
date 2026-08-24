const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPApi } = require('../server/cbcap-api');

function api() {
  const requests = [];
  return {
    requests,
    api: createCBCAPApi({
      geographyAgent: {
        async resolve() {
          return {
            fips: '36001',
            county: 'Albany County',
            state: 'NY',
            multiCounty: false,
            resolvedAs: 'fips',
          };
        },
      },
      engine: {
        async buildCountyPlan(request) {
          requests.push(structuredClone(request));
          return { type: 'cbcap_county_plan', status: 'awaiting_human_review', runId: 'run-1' };
        },
      },
    }),
  };
}

const assumption = {
  source: 'user',
  value: -10,
  unit: 'percent_change',
  range: { low: -15, high: -5 },
};

test('scenario request accepts only date context and forwards no client formula or model choice', async () => {
  const fixture = api();
  const result = await fixture.api.handle({
    location: '36001',
    assumptions: { testRateChange: assumption },
    scenario: { asOf: '2026-08-23', horizonEnd: '2027-08-23' },
  });

  assert.equal(result.statusCode, 202);
  assert.deepEqual(fixture.requests[0].scenario, {
    asOf: '2026-08-23',
    horizonEnd: '2027-08-23',
  });
  assert.deepEqual(fixture.requests[0].assumptions, { testRateChange: assumption });
});

test('scenario context is rejected without explicit user assumptions', async () => {
  const fixture = api();
  const result = await fixture.api.handle({
    location: '36001',
    scenario: { horizonEnd: '2027-08-23' },
  });

  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /requires explicit user assumptions/i);
  assert.equal(fixture.requests.length, 0);
});

test('scenario context rejects client supplied formula and model fields', async () => {
  const fixture = api();
  const result = await fixture.api.handle({
    location: '36001',
    assumptions: { testRateChange: assumption },
    scenario: {
      horizonEnd: '2027-08-23',
      formula: 'baseline * 999',
      modelVersion: 'client-selected-model',
    },
  });

  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /unsupported fields/i);
  assert.equal(fixture.requests.length, 0);
});

test('scenario context rejects invalid or non-future date ranges before evidence access', async () => {
  const fixture = api();
  const invalidDate = await fixture.api.handle({
    location: '36001',
    assumptions: { testRateChange: assumption },
    scenario: { asOf: '2026-02-30', horizonEnd: '2027-08-23' },
  });
  assert.equal(invalidDate.statusCode, 400);

  const reversed = await fixture.api.handle({
    location: '36001',
    assumptions: { testRateChange: assumption },
    scenario: { asOf: '2027-08-23', horizonEnd: '2027-08-23' },
  });
  assert.equal(reversed.statusCode, 400);
  assert.match(reversed.body.error, /must be after/i);
  assert.equal(fixture.requests.length, 0);
});
