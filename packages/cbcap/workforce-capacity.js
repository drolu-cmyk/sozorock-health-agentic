const CONTRACT = 'cbcap.workforce-capacity.v1';
const COUNTY_FIPS = /^\d{5}$/;

const REQUIRED_HPSA_COVERAGE_KEYS = Object.freeze([
  'hpsa:primary_care',
  'hpsa:dental',
  'hpsa:mental_health',
]);

const AHRF_RULES = Object.freeze({
  popn_est_23: Object.freeze({ kind: 'population_context', label: 'Estimated population', referenceYear: 2023, displayUnit: 'people' }),
  phys_nf_prim_care_pc_exc_rsdt_23: Object.freeze({ kind: 'primary_care_physicians', label: 'Nonfederal primary care physicians, excluding residents', referenceYear: 2023, displayUnit: 'professionals' }),
  dent_nf_fed_proflly_activ_23: Object.freeze({ kind: 'dentists', label: 'Professionally active dentists', referenceYear: 2023, displayUnit: 'professionals' }),
  rural_hlth_clincs_23: Object.freeze({ kind: 'rural_health_clinics', label: 'Rural health clinics', referenceYear: 2023, displayUnit: 'facilities' }),
  stgh_23: Object.freeze({ kind: 'short_term_general_hospitals', label: 'Short-term general hospitals', referenceYear: 2023, displayUnit: 'facilities' }),
  nhsc_prim_care_sites_24: Object.freeze({ kind: 'nhsc_primary_care_sites', label: 'National Health Service Corps primary care sites', referenceYear: 2024, displayUnit: 'sites' }),
  nhsc_fte_prim_care_provdrs_24: Object.freeze({ kind: 'nhsc_primary_care_provider_fte', label: 'National Health Service Corps primary care provider FTEs', referenceYear: 2024, displayUnit: 'full-time equivalents' }),
});

const INTERPRETATION_BOUNDARY = 'Contextual county workforce evidence only. It does not by itself establish shortage, appointment availability, quality, causation, provider adequacy, or a recommended response.';

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sourceMeasureId(measure) {
  return string(measure?.semantics?.source_measure_id).toLowerCase();
}

function sourceId(measure) {
  return string(measure?.source_version?.source_id);
}

function metadata(measure, key) {
  return measure?.source_metadata && Object.prototype.hasOwnProperty.call(measure.source_metadata, key)
    ? measure.source_metadata[key]
    : null;
}

function discipline(value) {
  const normalized = string(value).toLowerCase();
  if (normalized.includes('primary')) return 'primary_care';
  if (normalized.includes('dental')) return 'dental';
  if (normalized.includes('mental')) return 'mental_health';
  return 'unknown';
}

function referenceYear(measure) {
  const variableYear = metadata(measure, 'variableYear');
  if (variableYear !== null && variableYear !== undefined && String(variableYear).trim()) {
    const parsed = Number.parseInt(String(variableYear), 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  const years = new Set();
  for (const raw of [measure?.data_period_start, measure?.data_period_end]) {
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) years.add(parsed.getUTCFullYear());
  }
  return years.size === 1 ? [...years][0] : null;
}

function exactCountyMeasure(measure, countyFips) {
  return measure?.geography?.kind === 'county'
    && measure?.geography?.county_fips === countyFips
    && measure?.geography?.id === `county:${countyFips}`;
}

function verifiedMeasure(measure, countyFips) {
  return exactCountyMeasure(measure, countyFips)
    && measure?.review_status === 'verified'
    && measure?.source_version?.review_status === 'verified'
    && measure?.semantics?.review_status === 'verified';
}

function classifyHpsaMeasure(measure, countyFips) {
  const reasons = [];
  if (sourceId(measure) !== 'hrsa-workforce') reasons.push('not_hrsa_workforce_source');
  if (sourceMeasureId(measure) !== 'hpsa_designation') reasons.push('not_hpsa_designation_measure');
  if (!exactCountyMeasure(measure, countyFips)) reasons.push('county_geography_mismatch');
  if (measure?.review_status !== 'verified') reasons.push('observation_not_verified');
  if (measure?.source_version?.review_status !== 'verified') reasons.push('source_version_not_verified');
  if (measure?.semantics?.review_status !== 'verified') reasons.push('metric_semantics_not_verified');

  const scope = string(measure?.geography_level);
  if (!['county', 'population_group', 'facility', 'source_designation'].includes(scope)) reasons.push('unsupported_designation_scope');

  const designationName = string(metadata(measure, 'designationName'));
  const designationType = string(metadata(measure, 'designationType'));
  const componentType = string(metadata(measure, 'componentType'));
  const designationStatus = string(metadata(measure, 'designationStatus'));
  const wholeCounty = metadata(measure, 'wholeCountyGeographicDesignation');

  if (!designationName) reasons.push('designation_name_missing');
  if (!designationType) reasons.push('designation_type_missing');
  if (!componentType) reasons.push('component_type_missing');
  if (!designationStatus) reasons.push('designation_status_missing');
  if (scope === 'county' && wholeCounty !== true) reasons.push('county_scope_not_confirmed_by_source');
  if (scope !== 'county' && wholeCounty === true) reasons.push('scope_metadata_conflict');

  if (reasons.length) return { measureId: measure?.id || null, status: 'rejected', reasonCodes: [...new Set(reasons)].sort() };

  const item = {
    id: `workforce-designation:${measure.id}`,
    geographyId: measure.geography.id,
    scope,
    discipline: discipline(metadata(measure, 'discipline')),
    designationName,
    designationType,
    componentType,
    designationStatus,
    score: Number.isFinite(measure.numeric_value) ? measure.numeric_value : null,
    designationDate: measure.data_period_start || null,
    lastUpdateDate: metadata(measure, 'lastUpdateDate') || null,
    sourceMeasureId: measure.semantics.source_measure_id,
    sourceVersionId: measure.source_version.source_version_id,
    sourceObservationId: measure.id,
    reviewStatus: 'verified',
    wholeCountyGeographicDesignation: scope === 'county',
  };

  return {
    measureId: measure.id,
    status: 'admitted',
    reasonCodes: [],
    designation: item,
    countyBarrierContext: scope === 'county'
      ? {
          family: 'workforce',
          evidenceState: 'published_public_estimate',
          observedValue: item.score,
          sourceObservationId: measure.id,
          interpretation: 'Source-confirmed whole-county HPSA context. The HPSA score is preserved as published and is not converted into a CB-CAP severity score or county ranking.',
        }
      : null,
  };
}

function classifyAhrfMeasure(measure, countyFips) {
  const rule = AHRF_RULES[sourceMeasureId(measure)];
  if (!rule) return { measureId: measure?.id || null, status: 'rejected', reasonCodes: ['ahrf_variable_not_approved'] };

  const reasons = [];
  if (sourceId(measure) !== 'ahrf-workforce') reasons.push('not_ahrf_workforce_source');
  if (!verifiedMeasure(measure, countyFips)) reasons.push('verified_exact_county_measure_required');
  if (measure?.geography_level !== 'county') reasons.push('ahrf_capacity_requires_county_scope');
  if (measure?.semantics?.direction !== 'contextual') reasons.push('ahrf_capacity_must_be_contextual');
  if (measure?.semantics?.comparison_policy !== 'context_only') reasons.push('ahrf_capacity_must_be_context_only');
  if (!Number.isFinite(measure?.numeric_value)) reasons.push('numeric_value_required');
  const year = referenceYear(measure);
  if (year === null) reasons.push('ahrf_variable_year_missing');
  else if (year !== rule.referenceYear) reasons.push('ahrf_variable_year_mismatch');

  if (reasons.length) return { measureId: measure?.id || null, status: 'rejected', reasonCodes: [...new Set(reasons)].sort() };

  return {
    measureId: measure.id,
    status: 'admitted',
    reasonCodes: [],
    observation: {
      id: `workforce-capacity:${measure.geography.id}:${measure.id}`,
      geographyId: measure.geography.id,
      kind: rule.kind,
      label: rule.label,
      value: measure.numeric_value,
      displayUnit: rule.displayUnit,
      referenceYear: rule.referenceYear,
      sourceMeasureId: measure.semantics.source_measure_id,
      sourceVersionId: measure.source_version.source_version_id,
      sourceObservationId: measure.id,
      reviewStatus: 'verified',
      interpretationBoundary: INTERPRETATION_BOUNDARY,
    },
  };
}

function assessHpsaCoverage(sourceCoverage = [], admittedDesignations = []) {
  const byKey = new Map();
  const problemCodes = [];
  const assertionIds = [];
  for (const assertion of sourceCoverage) {
    if (assertion?.source_id !== 'hrsa-workforce' || !REQUIRED_HPSA_COVERAGE_KEYS.includes(assertion?.coverage_key)) continue;
    if (byKey.has(assertion.coverage_key)) {
      problemCodes.push(`duplicate_coverage_key:${assertion.coverage_key}`);
      continue;
    }
    byKey.set(assertion.coverage_key, assertion);
    if (assertion.id) assertionIds.push(assertion.id);
  }

  const missingKeys = REQUIRED_HPSA_COVERAGE_KEYS.filter((key) => !byKey.has(key));
  for (const key of missingKeys) problemCodes.push(`coverage_key_missing:${key}`);

  const designationKeys = new Set(admittedDesignations.map((item) => {
    if (item.discipline === 'primary_care') return 'hpsa:primary_care';
    if (item.discipline === 'dental') return 'hpsa:dental';
    if (item.discipline === 'mental_health') return 'hpsa:mental_health';
    return null;
  }).filter(Boolean));

  for (const [key, assertion] of byKey.entries()) {
    if (assertion.review_status !== 'verified') problemCodes.push(`coverage_not_verified:${key}`);
    if (!['complete_with_records', 'complete_no_records'].includes(assertion.status)) problemCodes.push(`coverage_not_complete:${key}:${assertion.status}`);
    if (assertion.status === 'complete_with_records' && !designationKeys.has(key)) problemCodes.push(`coverage_records_without_admitted_designation:${key}`);
    if (assertion.status === 'complete_no_records' && designationKeys.has(key)) problemCodes.push(`coverage_zero_records_with_designation:${key}`);
  }

  const complete = problemCodes.length === 0;
  const noDesignationsReported = complete && REQUIRED_HPSA_COVERAGE_KEYS.every((key) => byKey.get(key)?.status === 'complete_no_records');
  return {
    complete,
    noDesignationsReported,
    negativeEvidenceAllowed: complete,
    assertionIds,
    missingKeys,
    problemCodes: [...new Set(problemCodes)].sort(),
  };
}

function buildWorkforceCapacityView(evidence, countyFips) {
  const normalizedFips = String(countyFips || '').trim();
  if (!COUNTY_FIPS.test(normalizedFips)) throw new Error('countyFips must be a five-digit county FIPS.');
  if (!evidence || typeof evidence !== 'object' || evidence.countyFips !== normalizedFips) throw new Error('Workforce evidence must be the governed exact-county Evidence Gateway package.');
  if (!evidence.package || !Array.isArray(evidence.package.measures) || !Array.isArray(evidence.package.source_coverage)) {
    throw new Error('Workforce evidence package is incomplete.');
  }

  const hpsaDecisions = evidence.package.measures
    .filter((measure) => sourceId(measure) === 'hrsa-workforce')
    .map((measure) => classifyHpsaMeasure(measure, normalizedFips));
  const designations = hpsaDecisions.filter((item) => item.status === 'admitted').map((item) => item.designation);
  const countyBarrierContext = hpsaDecisions.filter((item) => item.countyBarrierContext).map((item) => item.countyBarrierContext);

  const capacityDecisions = evidence.package.measures
    .filter((measure) => sourceId(measure) === 'ahrf-workforce')
    .map((measure) => classifyAhrfMeasure(measure, normalizedFips));
  const capacityObservations = capacityDecisions.filter((item) => item.status === 'admitted').map((item) => item.observation);
  const coverage = assessHpsaCoverage(evidence.package.source_coverage, designations);

  const hasVerifiedEvidence = designations.length > 0 || capacityObservations.length > 0 || coverage.complete;
  return {
    contract: CONTRACT,
    countyFips: normalizedFips,
    evidenceRelease: { releaseId: evidence.releaseId, releaseHash: evidence.releaseHash },
    evidenceState: hasVerifiedEvidence ? 'published_public_estimate' : 'no_verified_data',
    designations,
    capacityObservations,
    countyBarrierContext,
    hpsaCoverage: coverage,
    rejected: {
      hpsa: hpsaDecisions.filter((item) => item.status === 'rejected'),
      capacity: capacityDecisions.filter((item) => item.status === 'rejected'),
    },
    compositeScore: null,
    countyRank: null,
    shortageVerdict: null,
    recommendedAllocation: null,
    interpretationBoundary: INTERPRETATION_BOUNDARY,
    humanJudgmentRequired: true,
  };
}

module.exports = {
  AHRF_RULES,
  CONTRACT,
  REQUIRED_HPSA_COVERAGE_KEYS,
  assessHpsaCoverage,
  buildWorkforceCapacityView,
  classifyAhrfMeasure,
  classifyHpsaMeasure,
};
