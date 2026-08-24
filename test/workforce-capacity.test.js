const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assessHpsaCoverage,
  buildWorkforceCapacityView,
  classifyAhrfMeasure,
  classifyHpsaMeasure,
} = require('../packages/cbcap/workforce-capacity');

const RELEASE_HASH = `sha256:${'a'.repeat(64)}`;

function geography() {
  return {
    id: 'county:36001',
    kind: 'county',
    county_fips: '36001',
    review_status: 'verified',
  };
}

function hpsaMeasure(overrides = {}) {
  const geographyLevel = overrides.geography_level || 'county';
  const wholeCounty = overrides.wholeCounty ?? (geographyLevel === 'county');
  return {
    id: overrides.id || `hpsa-${geographyLevel}`,
    semantics: {
      source_measure_id: 'HPSA_DESIGNATION',
      direction: 'contextual',
      comparison_policy: 'context_only',
      review_status: 'verified',
    },
    geography: geography(),
    source_version: {
      source_id: 'hrsa-workforce',
      source_version_id: 'hrsa-2026-08-22',
      review_status: 'verified',
    },
    geography_level: geographyLevel,
    numeric_value: 17,
    data_period_start: '2024-01-01',
    data_period_end: null,
    source_metadata: {
      designationName: 'Albany Primary Care HPSA',
      designationType: geographyLevel === 'facility' ? 'Facility HPSA' : geographyLevel === 'population_group' ? 'Population HPSA' : 'Geographic HPSA',
      componentType: geographyLevel === 'facility' ? 'Federally Qualified Health Center' : geographyLevel === 'population_group' ? 'Low Income Population' : 'Single County',
      discipline: overrides.discipline || 'Primary Care',
      designationStatus: 'Designated',
      lastUpdateDate: '2026-08-20',
      wholeCountyGeographicDesignation: wholeCounty,
    },
    review_status: 'verified',
    ...overrides,
  };
}

function ahrfMeasure(sourceMeasureId = 'phys_nf_prim_care_pc_exc_rsdt_23', overrides = {}) {
  return {
    id: `ahrf-${sourceMeasureId}`,
    semantics: {
      source_measure_id: sourceMeasureId,
      direction: 'contextual',
      comparison_policy: 'context_only',
      review_status: 'verified',
    },
    geography: geography(),
    source_version: {
      source_id: 'ahrf-workforce',
      source_version_id: 'ahrf-2025-release',
      review_status: 'verified',
    },
    geography_level: 'county',
    numeric_value: 321,
    data_period_start: '2023-01-01',
    data_period_end: '2023-12-31',
    source_metadata: { variableYear: '2023' },
    review_status: 'verified',
    ...overrides,
  };
}

function coverage(key, status = 'complete_no_records', recordsMatched = 0) {
  return {
    id: `coverage:${key}`,
    source_id: 'hrsa-workforce',
    source_version_id: 'hrsa-2026-08-22',
    geography_id: 'county:36001',
    coverage_key: key,
    status,
    records_matched: recordsMatched,
    evaluated_at: '2026-08-22T00:00:00.000Z',
    review_status: 'verified',
  };
}

function zeroCoverage() {
  return [
    coverage('hpsa:primary_care'),
    coverage('hpsa:dental'),
    coverage('hpsa:mental_health'),
  ];
}

function evidence(measures = [], sourceCoverage = zeroCoverage()) {
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'release-2026-08-23',
    releaseHash: RELEASE_HASH,
    countyFips: '36001',
    package: { measures, source_coverage: sourceCoverage },
  };
}

test('whole-county HPSA is preserved as workforce context without inventing a score or ranking', () => {
  const decision = classifyHpsaMeasure(hpsaMeasure(), '36001');
  assert.equal(decision.status, 'admitted');
  assert.equal(decision.designation.scope, 'county');
  assert.equal(decision.designation.discipline, 'primary_care');
  assert.equal(decision.countyBarrierContext.observedValue, 17);
  assert.match(decision.countyBarrierContext.interpretation, /not converted into a CB-CAP severity score/i);
});

test('population-group and facility HPSA records remain context and cannot become county shortage barriers', () => {
  for (const geographyLevel of ['population_group', 'facility']) {
    const decision = classifyHpsaMeasure(hpsaMeasure({ geography_level: geographyLevel, wholeCounty: false }), '36001');
    assert.equal(decision.status, 'admitted');
    assert.equal(decision.designation.scope, geographyLevel);
    assert.equal(decision.countyBarrierContext, null);
  }
});

test('county HPSA fails closed without source confirmation that the designation is whole county', () => {
  const decision = classifyHpsaMeasure(hpsaMeasure({ wholeCounty: false }), '36001');
  assert.equal(decision.status, 'rejected');
  assert.ok(decision.reasonCodes.includes('county_scope_not_confirmed_by_source'));
});

test('HPSA negative evidence requires all three verified complete source coverage assertions', () => {
  const complete = assessHpsaCoverage(zeroCoverage(), []);
  assert.equal(complete.complete, true);
  assert.equal(complete.noDesignationsReported, true);
  assert.equal(complete.negativeEvidenceAllowed, true);

  const incomplete = assessHpsaCoverage(zeroCoverage().slice(0, 2), []);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.negativeEvidenceAllowed, false);
  assert.ok(incomplete.missingKeys.includes('hpsa:mental_health'));
});

test('HPSA coverage records and admitted designations must agree', () => {
  const designation = classifyHpsaMeasure(hpsaMeasure(), '36001').designation;
  const assertions = zeroCoverage();
  assertions[0] = coverage('hpsa:primary_care', 'complete_with_records', 1);
  assert.equal(assessHpsaCoverage(assertions, [designation]).complete, true);

  const conflict = assessHpsaCoverage(zeroCoverage(), [designation]);
  assert.equal(conflict.complete, false);
  assert.ok(conflict.problemCodes.includes('coverage_zero_records_with_designation:hpsa:primary_care'));
});

test('AHRF capacity admits only reviewed context-only allowlisted variables with matching year', () => {
  const admitted = classifyAhrfMeasure(ahrfMeasure(), '36001');
  assert.equal(admitted.status, 'admitted');
  assert.equal(admitted.observation.kind, 'primary_care_physicians');
  assert.equal(admitted.observation.referenceYear, 2023);
  assert.match(admitted.observation.interpretationBoundary, /does not by itself establish shortage/i);

  const unapproved = classifyAhrfMeasure(ahrfMeasure('made_up_capacity_field'), '36001');
  assert.equal(unapproved.status, 'rejected');
  assert.deepEqual(unapproved.reasonCodes, ['ahrf_variable_not_approved']);

  const ranked = classifyAhrfMeasure(ahrfMeasure('phys_nf_prim_care_pc_exc_rsdt_23', {
    semantics: {
      source_measure_id: 'phys_nf_prim_care_pc_exc_rsdt_23',
      direction: 'higher_is_better',
      comparison_policy: 'rankable',
      review_status: 'verified',
    },
  }), '36001');
  assert.equal(ranked.status, 'rejected');
  assert.ok(ranked.reasonCodes.includes('ahrf_capacity_must_be_contextual'));
  assert.ok(ranked.reasonCodes.includes('ahrf_capacity_must_be_context_only'));
});

test('workforce view never returns composite score, county rank, shortage verdict, or funding allocation', () => {
  const assertions = zeroCoverage();
  assertions[0] = coverage('hpsa:primary_care', 'complete_with_records', 1);
  const result = buildWorkforceCapacityView(evidence([
    hpsaMeasure(),
    ahrfMeasure(),
  ], assertions), '36001');

  assert.equal(result.contract, 'cbcap.workforce-capacity.v1');
  assert.equal(result.evidenceState, 'published_public_estimate');
  assert.equal(result.designations.length, 1);
  assert.equal(result.capacityObservations.length, 1);
  assert.equal(result.compositeScore, null);
  assert.equal(result.countyRank, null);
  assert.equal(result.shortageVerdict, null);
  assert.equal(result.recommendedAllocation, null);
  assert.equal(result.humanJudgmentRequired, true);
});

test('workforce view fails closed on cross-county or incomplete evidence envelope', () => {
  assert.throws(() => buildWorkforceCapacityView({ ...evidence(), countyFips: '36093' }, '36001'), /exact-county/i);
  assert.throws(() => buildWorkforceCapacityView({ ...evidence(), package: { measures: [] } }, '36001'), /incomplete/i);
});
