const { validateEvidenceEnvelope } = require('../runtime/contracts');

const BARRIER_CONTRACT = 'cbcap.barrier-intelligence.v1';
const BARRIER_FAMILIES = Object.freeze([
  'care_availability',
  'workforce',
  'affordability_and_insurance',
  'transportation_and_travel',
  'food_security_and_food_access',
  'housing',
  'utilities',
  'digital_access',
  'language_and_information_access',
  'built_environment',
  'social_connection_and_support',
  'environmental_context',
  'preventive_service_gaps',
  'public_health_capacity',
]);
const COVERAGE_CLASSES = Object.freeze(['national_complete', 'partial_coverage', 'local_only']);

function text(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function validateRegistryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Barrier registry entry must be an object.');
  const semanticsId = text(entry.semanticsId, 'semanticsId', 240);
  const barrierFamily = text(entry.barrierFamily, 'barrierFamily', 100);
  if (!BARRIER_FAMILIES.includes(barrierFamily)) throw new Error(`Unsupported barrier family ${barrierFamily}.`);
  const coverageClass = text(entry.coverageClass, 'coverageClass', 40);
  if (!COVERAGE_CLASSES.includes(coverageClass)) throw new Error(`Unsupported coverage class ${coverageClass}.`);
  const sourceClass = text(entry.sourceClass, 'sourceClass', 120);
  const geometryRule = text(entry.geometryRule, 'geometryRule', 240);
  const reviewStatus = text(entry.reviewStatus || 'verified', 'reviewStatus', 40);
  if (reviewStatus !== 'verified') throw new Error('Barrier registry entries must be verified before use.');
  return Object.freeze({
    semanticsId,
    barrierFamily,
    coverageClass,
    sourceClass,
    geometryRule,
    reviewStatus,
  });
}

class BarrierRegistry {
  constructor(entries = []) {
    if (!Array.isArray(entries)) throw new Error('Barrier registry entries must be an array.');
    this.bySemanticsId = new Map();
    for (const entry of entries) this.register(entry);
  }

  register(entry) {
    const normalized = validateRegistryEntry(entry);
    if (this.bySemanticsId.has(normalized.semanticsId)) throw new Error(`Duplicate barrier metric ${normalized.semanticsId}.`);
    this.bySemanticsId.set(normalized.semanticsId, normalized);
    return normalized;
  }

  get(semanticsId) {
    return this.bySemanticsId.get(String(semanticsId)) || null;
  }

  require(semanticsId) {
    const found = this.get(semanticsId);
    if (!found) throw new Error(`Barrier metric ${semanticsId} is not registered.`);
    return found;
  }

  list() {
    return [...this.bySemanticsId.values()].map(clone);
  }
}

function validateSemantics(semantics) {
  if (!semantics || typeof semantics !== 'object' || Array.isArray(semantics)) throw new Error('Measure semantics are required.');
  const id = text(semantics.id, 'semantics.id', 240);
  text(semantics.source_measure_id, 'semantics.source_measure_id', 240);
  text(semantics.name, 'semantics.name', 500);
  text(semantics.direction, 'semantics.direction', 80);
  text(semantics.unit, 'semantics.unit', 120);
  text(semantics.universe, 'semantics.universe', 500);
  if (semantics.review_status !== 'verified') throw new Error(`Barrier metric ${id} is not verified.`);
  if (!Array.isArray(semantics.allowed_geography_kinds)) throw new Error(`Barrier metric ${id} is missing allowed_geography_kinds.`);
  if (!Array.isArray(semantics.allowed_visualizations)) throw new Error(`Barrier metric ${id} is missing allowed_visualizations.`);
  return semantics;
}

function coverageForObservation(envelope, measure) {
  const geographyId = measure?.geography?.id;
  const sourceVersionId = measure?.source_version?.source_version_id;
  if (!geographyId || !sourceVersionId) return [];
  return envelope.sourceCoverage
    .filter((assertion) => assertion?.geography_id === geographyId && assertion?.source_version_id === sourceVersionId)
    .map(clone);
}

function toBarrierObservation(envelope, measure, registry) {
  if (!measure || typeof measure !== 'object' || Array.isArray(measure)) throw new Error('Barrier measure must be an object.');
  const semantics = validateSemantics(measure.semantics);
  const registration = registry.require(semantics.id);
  if (measure.review_status !== 'verified') throw new Error(`Barrier observation ${measure.id || 'unknown'} is not verified.`);
  if (measure.geography?.review_status !== 'verified') throw new Error(`Barrier observation ${measure.id || 'unknown'} geography is not verified.`);
  if (measure.source_version?.review_status !== 'verified') throw new Error(`Barrier observation ${measure.id || 'unknown'} source version is not verified.`);
  if (!semantics.allowed_geography_kinds.includes(measure.geography?.kind)) {
    throw new Error(`Barrier metric ${semantics.id} is not approved for geography ${measure.geography?.kind || 'missing'}.`);
  }
  return {
    contract: BARRIER_CONTRACT,
    observationId: text(measure.id, 'measure.id', 300),
    barrierFamily: registration.barrierFamily,
    semanticsId: semantics.id,
    sourceMeasureId: semantics.source_measure_id,
    name: semantics.name,
    value: clone(measure.value),
    numericValue: measure.numeric_value ?? null,
    unit: semantics.unit,
    universe: semantics.universe,
    direction: semantics.direction,
    higherValueMeaning: semantics.higher_value_meaning ?? null,
    comparisonPolicy: semantics.comparison_policy ?? null,
    dataPeriodStart: measure.data_period_start ?? null,
    dataPeriodEnd: measure.data_period_end ?? null,
    confidenceLow: measure.confidence_low ?? null,
    confidenceHigh: measure.confidence_high ?? null,
    marginOfError: measure.margin_of_error ?? null,
    geography: clone(measure.geography),
    sourceVersion: clone(measure.source_version),
    sourceMetadata: clone(measure.source_metadata || {}),
    sourceCoverage: coverageForObservation(envelope, measure),
    coverageClass: registration.coverageClass,
    sourceClass: registration.sourceClass,
    geometryRule: registration.geometryRule,
    permissions: {
      trendable: semantics.trendable === true,
      forecastable: semantics.forecastable === true,
      aggregatable: semantics.aggregatable === true,
      allowedGeographyKinds: clone(semantics.allowed_geography_kinds),
      allowedVisualizations: clone(semantics.allowed_visualizations),
    },
    reviewStatus: 'verified',
  };
}

function normalizeEnvelope(evidence, countyFips) {
  const envelope = validateEvidenceEnvelope(evidence, countyFips);
  return {
    ...envelope,
    measures: clone(evidence.measures),
    metricSemantics: clone(evidence.metricSemantics),
    sourceCoverage: clone(evidence.sourceCoverage),
  };
}

function queryBarrierEvidence(evidence, options = {}) {
  const countyFips = options.countyFips ? text(options.countyFips, 'countyFips', 5) : null;
  const registry = options.registry instanceof BarrierRegistry ? options.registry : new BarrierRegistry(options.registry || []);
  const envelope = normalizeEnvelope(evidence, countyFips);
  const requestedFamilies = Array.isArray(options.barrierFamilies) ? new Set(options.barrierFamilies) : null;
  if (requestedFamilies) {
    for (const family of requestedFamilies) if (!BARRIER_FAMILIES.includes(family)) throw new Error(`Unsupported barrier family ${family}.`);
  }
  const requestedSemantics = Array.isArray(options.semanticsIds) ? new Set(options.semanticsIds) : null;

  const observations = [];
  for (const measure of envelope.measures) {
    const registration = registry.get(measure?.semantics?.id);
    if (!registration) {
      if (requestedSemantics?.has(measure?.semantics?.id)) registry.require(measure?.semantics?.id);
      continue;
    }
    if (requestedFamilies && !requestedFamilies.has(registration.barrierFamily)) continue;
    if (requestedSemantics && !requestedSemantics.has(measure.semantics.id)) continue;
    observations.push(toBarrierObservation(envelope, measure, registry));
  }

  if (requestedSemantics) {
    for (const semanticsId of requestedSemantics) registry.require(semanticsId);
  }

  return {
    contract: BARRIER_CONTRACT,
    releaseId: envelope.releaseId,
    releaseHash: envelope.releaseHash,
    countyFips: envelope.countyFips,
    observations,
    sourceCoverage: clone(envelope.sourceCoverage),
    registry: registry.list(),
    compositeScore: null,
    causalInference: false,
    privateTenantStateWrittenToEvidenceCore: false,
  };
}

function createBarrierInteraction(input = {}) {
  const id = text(input.id, 'interaction.id', 240);
  const label = text(input.label, 'interaction.label', 500);
  if (!Array.isArray(input.observations) || input.observations.length < 2) {
    throw new Error('Barrier interaction requires at least two observations.');
  }
  const componentEvidenceIds = [...new Set(input.observations.map((item) => text(item?.observationId, 'observationId', 300)))];
  if (componentEvidenceIds.length < 2) throw new Error('Barrier interaction requires distinct component evidence IDs.');
  return {
    contract: BARRIER_CONTRACT,
    interactionId: id,
    label,
    relationship: 'co_occurrence_only',
    componentEvidenceIds,
    barrierFamilies: [...new Set(input.observations.map((item) => text(item?.barrierFamily, 'barrierFamily', 100)))],
    causalClaim: false,
    score: null,
    requiredDisclosure: 'This interaction shows reviewed evidence appearing together; it does not establish causation or a composite barrier score.',
  };
}

function authorizeBarrierVisualization(registry, semanticsId, visualization) {
  if (!(registry instanceof BarrierRegistry)) throw new Error('Barrier visualization authorization requires a BarrierRegistry.');
  const registration = registry.require(semanticsId);
  const semantics = arguments.length > 3 ? arguments[3] : null;
  if (!semantics || semantics.id !== registration.semanticsId) throw new Error(`Reviewed semantics are required for ${semanticsId}.`);
  validateSemantics(semantics);
  if (!semantics.allowed_visualizations.includes(visualization)) throw new Error(`Visualization ${visualization} is not approved for ${semanticsId}.`);
  return true;
}

function authorizeBarrierForecast(registry, semanticsId, semantics) {
  if (!(registry instanceof BarrierRegistry)) throw new Error('Barrier forecast authorization requires a BarrierRegistry.');
  registry.require(semanticsId);
  validateSemantics(semantics);
  if (semantics.id !== semanticsId || semantics.forecastable !== true) throw new Error(`Forecasting is not approved for ${semanticsId}.`);
  return true;
}

module.exports = {
  BARRIER_CONTRACT,
  BARRIER_FAMILIES,
  BarrierRegistry,
  authorizeBarrierForecast,
  authorizeBarrierVisualization,
  createBarrierInteraction,
  queryBarrierEvidence,
  toBarrierObservation,
  validateRegistryEntry,
};
