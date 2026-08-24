const MODEL_ID = 'proportional_change_range_v1';
const MODEL_VERSION = '1.0.0';

function requiredString(value, label, max = 300) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function userAssumption(assumptions, key) {
  const entry = assumptions?.[key];
  if (!entry || typeof entry !== 'object' || entry.source !== 'user') {
    throw new Error(`Scenario assumption ${key} must be explicitly supplied with source=user.`);
  }
  return entry.value;
}

function verifiedBaseline(evidence, sourceMeasureId) {
  const measures = Array.isArray(evidence?.package?.measures) ? evidence.package.measures : [];
  const matches = measures.filter((measure) => {
    const semantics = measure?.semantics;
    const geography = measure?.geography;
    const source = measure?.source_version;
    return semantics?.source_measure_id === sourceMeasureId
      && measure?.review_status === 'verified'
      && semantics?.review_status === 'verified'
      && geography?.review_status === 'verified'
      && geography?.kind === 'county'
      && source?.review_status === 'verified'
      && typeof measure?.numeric_value === 'number'
      && Number.isFinite(measure.numeric_value);
  });
  if (matches.length !== 1) throw new Error('Scenario baseline must resolve to exactly one verified county measure.');
  return matches[0];
}

function semanticBounds(measure) {
  const unit = String(measure?.semantics?.unit || '').toLowerCase();
  if (unit.includes('percent') || unit === '%' || unit.includes('percentage')) return { min: 0, max: 100 };
  if (measure?.numeric_value >= 0) return { min: 0, max: null };
  return { min: null, max: null };
}

function validateOutputBounds(low, high, bounds) {
  if (bounds.min !== null && (low < bounds.min || high < bounds.min)) throw new Error('Scenario range violates the reviewed measure lower bound.');
  if (bounds.max !== null && (low > bounds.max || high > bounds.max)) throw new Error('Scenario range violates the reviewed measure upper bound.');
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function evaluateProportionalRange(input) {
  const evidence = input?.evidence;
  if (!evidence?.releaseId || !evidence?.releaseHash || !evidence?.contract) throw new Error('Scenario evidence release identity is required.');
  const assumptions = input?.assumptions;
  const modelId = requiredString(userAssumption(assumptions, 'scenarioModelId'), 'scenarioModelId', 100);
  if (modelId !== MODEL_ID) throw new Error(`Unsupported governed scenario model ${modelId}.`);
  const sourceMeasureId = requiredString(userAssumption(assumptions, 'baselineSourceMeasureId'), 'baselineSourceMeasureId', 240);
  const lowPct = finite(userAssumption(assumptions, 'relativeChangePctLow'), 'relativeChangePctLow');
  const highPct = finite(userAssumption(assumptions, 'relativeChangePctHigh'), 'relativeChangePctHigh');
  if (lowPct > highPct) throw new Error('relativeChangePctLow cannot exceed relativeChangePctHigh.');
  if (lowPct < -100 || highPct > 500) throw new Error('Scenario relative-change assumptions are outside the reviewed model bounds.');

  const baseline = verifiedBaseline(evidence, sourceMeasureId);
  const value = baseline.numeric_value;
  const low = round(value * (1 + lowPct / 100));
  const high = round(value * (1 + highPct / 100));
  validateOutputBounds(low, high, semanticBounds(baseline));

  return {
    contract: 'cbcap.scenario.v1',
    status: 'modeled_planning_range',
    model: {
      id: MODEL_ID,
      version: MODEL_VERSION,
      evaluationStatus: 'not_backtested',
      intendedUse: 'bounded_planning_scenario',
      predictionClaim: false,
    },
    geography: {
      id: baseline.geography.id,
      countyFips: baseline.geography.county_fips,
      displayName: baseline.geography.display_name,
    },
    evidenceRelease: {
      contract: evidence.contract,
      releaseId: evidence.releaseId,
      releaseHash: evidence.releaseHash,
    },
    baseline: {
      sourceMeasureId,
      measureDefinitionId: baseline.semantics.id,
      name: baseline.semantics.name,
      value,
      unit: baseline.semantics.unit,
      universe: baseline.semantics.universe,
      sourceVersionId: baseline.source_version.source_version_id,
      dataPeriodStart: baseline.data_period_start || null,
      dataPeriodEnd: baseline.data_period_end || null,
    },
    assumptions: {
      relativeChangePctLow: { source: 'user', value: lowPct },
      relativeChangePctHigh: { source: 'user', value: highPct },
    },
    formula: {
      low: 'baseline * (1 + relativeChangePctLow / 100)',
      high: 'baseline * (1 + relativeChangePctHigh / 100)',
      outputUnit: baseline.semantics.unit,
    },
    range: { low, high, unit: baseline.semantics.unit },
    uncertainty: {
      type: 'user_assumption_range',
      probabilityDistribution: null,
      confidenceLevel: null,
    },
    caveats: [
      'This is a bounded planning scenario, not a prediction or forecast.',
      'The range changes only the selected baseline measure under explicit user assumptions; it does not infer causation or implementation effects.',
      'The model has not been backtested and must not be used as an award, clinical, budget, or population-outcome prediction.',
    ],
    humanReviewRequired: true,
  };
}

function createGovernedScenarioHandler() {
  return async function governedScenarioHandler(stateOrInput, maybeContext) {
    if (stateOrInput?.evidence && stateOrInput?.assumptions) return evaluateProportionalRange(stateOrInput);
    if (stateOrInput?.package && maybeContext?.assumptions) return evaluateProportionalRange({ evidence: stateOrInput, assumptions: maybeContext.assumptions });
    if (stateOrInput && maybeContext?.package) return evaluateProportionalRange({ assumptions: stateOrInput, evidence: maybeContext });
    throw new Error('Governed scenario handler requires evidence and explicit user assumptions.');
  };
}

module.exports = {
  MODEL_ID,
  MODEL_VERSION,
  createGovernedScenarioHandler,
  evaluateProportionalRange,
  verifiedBaseline,
};
