const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPApi } = require('../server/cbcap-api');

const COMPLETE_APPROVAL = {
  status: 'approved',
  by: 'reviewer-1',
  scope: 'county_plan',
  reviewedAt: '2026-08-24T00:00:00.000Z',
};

function apiWith({ resolve, build } = {}) {
  const calls = { engine: 0, requests: [] };
  const geographyAgent = {
    async resolve(query) {
      if (resolve) return resolve(query);
      return {
        fips: '36001',
        county: 'Albany County',
        state: 'NY',
        multiCounty: false,
        resolvedAs: 'fips',
      };
    },
  };
  const engine = {
    async buildCountyPlan(request) {
      calls.engine += 1;
      calls.requests.push(structuredClone(request));
      if (build) return build(request);
      return { type: 'cbcap_county_plan', status: 'awaiting_human_review', runId: 'run-1' };
    },
  };
  return { api: createCBCAPApi({ geographyAgent, engine }), calls };
}

test('HTTP resolver passes only resolved county FIPS into the planning engine', async () => {
  const { api, calls } = apiWith({
    resolve: async (query) => ({
      fips: '36001',
      county: 'Albany County',
      state: 'NY',
      multiCounty: false,
      resolvedAs: query.includes('Albany') ? 'name_state' : 'fips',
    }),
  });
  const result = await api.handle({ location: 'Albany, NY' });

  assert.equal(result.statusCode, 202);
  assert.equal(calls.engine, 1);
  assert.equal(calls.requests[0].countyFips, '36001');
  assert.equal(result.body.placeResolution.countyFips, '36001');
  assert.equal(result.body.placeResolution.input, 'Albany, NY');
});

test('multi-county ZIP stops before the planning engine', async () => {
  const { api, calls } = apiWith({
    resolve: async () => ({
      fips: '36027',
      county: 'Dutchess',
      state: 'NY',
      multiCounty: true,
      resolvedAs: 'zip',
      allCounties: [
        { fips: '36027', name: 'Dutchess', resRatio: 0.65 },
        { fips: '36111', name: 'Ulster', resRatio: 0.35 },
      ],
    }),
  });
  const result = await api.handle({ location: '12566' });

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.status, 'needs_place_selection');
  assert.equal(result.body.error.code, 'multi_county_selection_required');
  assert.equal(result.body.place.matches.length, 2);
  assert.equal(calls.engine, 0);
});

test('ambiguous county name stops before the planning engine', async () => {
  const { api, calls } = apiWith({
    resolve: async () => ({
      status: 'ambiguous',
      message: 'Multiple counties match this name. Specify the state before continuing.',
      matches: [
        { fips: '06059', county: 'Orange', state: 'CA' },
        { fips: '12095', county: 'Orange', state: 'FL' },
      ],
    }),
  });
  const result = await api.handle({ location: 'Orange' });

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, 'place_selection_required');
  assert.equal(calls.engine, 0);
});

test('unresolved geography returns a selection state instead of guessing', async () => {
  const { api, calls } = apiWith({ resolve: async () => null });
  const result = await api.handle({ location: 'Not a verified place' });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, 'place_not_resolved');
  assert.equal(calls.engine, 0);
});

test('invalid assumptions are rejected before the planning engine', async () => {
  const { api, calls } = apiWith();
  const result = await api.handle({
    location: '36001',
    assumptions: { uptakeRate: { source: 'model', value: 0.1 } },
  });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /source=user/);
  assert.equal(calls.engine, 0);
});

test('incomplete approval is rejected before the planning engine', async () => {
  const { api, calls } = apiWith();
  const result = await api.handle({
    location: '36001',
    approval: { status: 'approved', by: 'reviewer-1', scope: 'county_plan' },
  });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /reviewedAt/);
  assert.equal(calls.engine, 0);
});

test('complete approval and user assumptions are passed through unchanged', async () => {
  const { api, calls } = apiWith({
    build: async () => ({ type: 'cbcap_county_plan', status: 'approved_output', runId: 'run-2' }),
  });
  const assumptions = {
    uptakeRate: { source: 'user', value: 0.1 },
    note: { source: 'user', value: 'planning sensitivity' },
  };
  const result = await api.handle({ location: '36001', assumptions, approval: COMPLETE_APPROVAL });

  assert.equal(result.statusCode, 200);
  assert.equal(calls.engine, 1);
  assert.deepEqual(calls.requests[0].assumptions, assumptions);
  assert.deepEqual(calls.requests[0].approval, COMPLETE_APPROVAL);
});

test('governed evidence failure is sanitized at the HTTP boundary', async () => {
  const { api } = apiWith({
    build: async () => ({
      status: 'blocked',
      runId: 'run-3',
      error: { code: 'node_error', reason: 'internal upstream detail that must not escape' },
    }),
  });
  const result = await api.handle({ location: '36001' });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, 'evidence_unavailable');
  assert.equal(JSON.stringify(result.body).includes('internal upstream detail'), false);
});
