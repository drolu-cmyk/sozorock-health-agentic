const { BarrierRegistry } = require('./barrier-intelligence');

const REVIEWED_SOURCE_MEASURES = Object.freeze({
  'ACCESS2:Crude': Object.freeze({
    barrierFamily: 'affordability_and_insurance',
    coverageClass: 'partial_coverage',
    sourceId: 'cdc-places',
    sourceClass: 'CDC PLACES modeled county estimate',
    geometryRule: 'county modeled estimate only; do not transfer to tract, ZCTA, ZIP, person, or household',
  }),
  'LACKTRPT:Crude': Object.freeze({
    barrierFamily: 'transportation_and_travel',
    coverageClass: 'partial_coverage',
    sourceId: 'cdc-places',
    sourceClass: 'CDC PLACES health-related social-needs modeled county estimate',
    geometryRule: 'county modeled estimate only; missing HRSN coverage remains unavailable',
  }),
  'FOODINSECU:Crude': Object.freeze({
    barrierFamily: 'food_security_and_food_access',
    coverageClass: 'partial_coverage',
    sourceId: 'cdc-places',
    sourceClass: 'CDC PLACES health-related social-needs modeled county estimate',
    geometryRule: 'county modeled estimate only; do not substitute USDA retailer-access methodology',
  }),
  'HOUSINSECU:Crude': Object.freeze({
    barrierFamily: 'housing',
    coverageClass: 'partial_coverage',
    sourceId: 'cdc-places',
    sourceClass: 'CDC PLACES health-related social-needs modeled county estimate',
    geometryRule: 'county modeled estimate only; do not infer household-level housing instability',
  }),
  'SHUTUTILITY:Crude': Object.freeze({
    barrierFamily: 'utilities',
    coverageClass: 'partial_coverage',
    sourceId: 'cdc-places',
    sourceClass: 'CDC PLACES health-related social-needs modeled county estimate',
    geometryRule: 'county modeled estimate only; do not infer individual utility status',
  }),
  'LONELINESS:Crude': Object.freeze({
    barrierFamily: 'social_connection_and_support',
    coverageClass: 'partial_coverage',
    sourceId: 'cdc-places',
    sourceClass: 'CDC PLACES health-related social-needs modeled county estimate',
    geometryRule: 'county modeled estimate only; do not infer individual social isolation',
  }),
  HPSA_DESIGNATION: Object.freeze({
    barrierFamily: 'workforce',
    coverageClass: 'national_complete',
    sourceId: 'hrsa-workforce',
    sourceClass: 'HRSA Health Professional Shortage Area designation',
    geometryRule: 'retain official designation type, discipline, status, population or facility scope; treat as countywide only when source marks whole-county geography',
  }),
  MUA_P_DESIGNATION: Object.freeze({
    barrierFamily: 'care_availability',
    coverageClass: 'national_complete',
    sourceId: 'hrsa-workforce',
    sourceClass: 'HRSA Medically Underserved Area or Population designation',
    geometryRule: 'retain official MUA/P geography or population scope; absence is interpretable only with complete reviewed source coverage',
  }),
});

function buildReviewedBarrierRegistry(metricSemantics = []) {
  if (!Array.isArray(metricSemantics)) throw new Error('metricSemantics must be an array.');
  const entries = [];
  for (const semantics of metricSemantics) {
    if (!semantics || semantics.review_status !== 'verified') continue;
    const policy = REVIEWED_SOURCE_MEASURES[semantics.source_measure_id];
    if (!policy) continue;
    entries.push({
      semanticsId: semantics.id,
      ...policy,
      reviewStatus: 'verified',
    });
  }
  return new BarrierRegistry(entries);
}

module.exports = {
  REVIEWED_SOURCE_MEASURES,
  buildReviewedBarrierRegistry,
};
