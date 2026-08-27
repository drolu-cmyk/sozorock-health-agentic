const test = require('node:test');
const assert = require('node:assert/strict');
const { createCBCAPApi } = require('../server/cbcap-api');

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
      resolvedAs: 'census_zcta_proxy',
      resolutionMethod: 'census_zcta_proxy',
      caveat: 'A postal ZIP Code is not a Census ZCTA.',
      allCounties: [
        { fips: '36027', name: 'Dutchess', areaRatio: 0.65 },
        { fips: '36111', name: 'Ulster', areaRatio: 0.35 },
      ],
    }),
  });
  const result = await api.handle({ location: '12566' });

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.status, 'needs_place_selection');
  assert.equal(result.body.error.code, 'multi_county_selection_required');
  assert.equal(result.body.place.kind, 'multi_county_census_zcta_proxy');
  assert.equal(result.body.place.resolutionMethod, 'census_zcta_proxy');
  assert.match(result.body.place.caveat, /not a Census ZCTA/i);
  assert.equal(result.body.place.matches[0].landAreaShare, 0.65);
  assert.equal(result.body.place.matches[0].residentialShare, null);
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

test('initial planning request cannot carry approval', async () => {
  const { api, calls } = apiWith();
  const result = await api.handle({
    location: '36001',
    approval: {
      status: 'approved',
      decision: 'approve',
      by: 'reviewer-1',
      scope: 'county_plan',
      reviewedAt: '2026-08-24T00:00:00.000Z',
      objectId: 'run-1',
      evidenceReleaseId: 'release-1',
    },
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.code, 'review_continuation_required');
  assert.match(result.body.error, /exact saved run/i);
  assert.equal(calls.engine, 0);
});

test('valid user assumptions are passed through without creating approval state', async () => {
  const { api, calls } = apiWith();
  const assumptions = {
    uptakeRate: { source: 'user', value: 0.1 },
    note: { source: 'user', value: 'planning sensitivity' },
  };
  const result = await api.handle({ location: '36001', assumptions });

  assert.equal(result.statusCode, 202);
  assert.equal(calls.engine, 1);
  assert.deepEqual(calls.requests[0].assumptions, assumptions);
  assert.equal(Object.prototype.hasOwnProperty.call(calls.requests[0], 'approval'), false);
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
