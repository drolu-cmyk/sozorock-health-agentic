const { hasUserAssumptions } = require('../runtime/contracts');

const SCENARIO_CONTRACT = 'cbcap.scenario.v1';
const ALLOWED_METHODS = new Set(['absolute_change', 'relative_fraction', 'relative_percent']);
const COUNTY_FIPS = /^\d{5}$/;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requiredString(value, label, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function dateOnly(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar date.`);
  }
  return value;
}

function toUtcDay(value) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function daysBetween(start, end) {
  return Math.round((toUtcDay(end) - toUtcDay(start)) / 86400000);
}

function normalizeRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Scenario model registration must be an object.');
  }
  const method = requiredString(input.method, 'scenario model method', 80);
  if (!ALLOWED_METHODS.has(method)) throw new Error(`Unsupported scenario model method ${method}.`);
  const allowedSourceIds = Array.isArray(input.allowedSourceIds)
    ? input.allowedSourceIds.map((item) => requiredString(item, 'scenario model source ID'))
    : [];
  if (allowedSourceIds.length === 0) throw new Error('Scenario model registration requires at least one allowed source ID.');
  if (new Set(allowedSourceIds).size !== allowedSourceIds.length) {
    throw new Error('Scenario model allowed source IDs must be unique.');
  }
  const maximumHorizonDays = input.maximumHorizonDays;
  if (!Number.isInteger(maximumHorizonDays) || maximumHorizonDays < 1 || maximumHorizonDays > 36525) {
    throw new Error('Scenario model maximumHorizonDays must be an integer between 1 and 36525.');
  }
  const reviewStatus = requiredString(input.reviewStatus, 'scenario model reviewStatus', 40);
  const approvedAt = dateOnly(input.approvedAt, 'scenario model approvedAt');
  return Object.freeze({
    id: requiredString(input.id, 'scenario model id'),
    assumptionKey: requiredString(input.assumptionKey, 'scenario model assumptionKey'),
    inputSourceMeasureId: requiredString(input.inputSourceMeasureId, 'scenario model inputSourceMeasureId'),
    outputKey: requiredString(input.outputKey || input.assumptionKey, 'scenario model outputKey'),
    outputLabel: requiredString(input.outputLabel || input.outputKey || input.assumptionKey, 'scenario model outputLabel'),
    method,
    modelVersion: requiredString(input.modelVersion, 'scenario model modelVersion'),
    methodVersion: requiredString(input.methodVersion, 'scenario model methodVersion'),
    assumptionUnit: requiredString(input.assumptionUnit, 'scenario model assumptionUnit'),
    allowedSourceIds: Object.freeze([...allowedSourceIds]),
    maximumHorizonDays,
    reviewStatus,
    approvedBy: requiredString(input.approvedBy, 'scenario model approvedBy'),
    approvedAt,
  });
}

function normalizeAssumption(key, entry) {
  const reasons = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { key, status: 'blocked', reasonCodes: ['assumption_invalid'], assumption: null };
  }
  if (entry.source !== 'user') reasons.push('assumption_not_user_supplied');
  if (!finite(entry.value)) reasons.push('assumption_value_not_numeric');
  if (typeof entry.unit !== 'string' || !entry.unit.trim()) reasons.push('assumption_unit_required');
  const range = entry.range;
  if (!range || typeof range !== 'object' || Array.isArray(range) || !finite(range.low) || !finite(range.high)) {
    reasons.push('assumption_range_required');
  } else {
    if (range.low > range.high) reasons.push('assumption_range_invalid');
    if (finite(entry.value) && (entry.value < range.low || entry.value > range.high)) {
      reasons.push('assumption_value_outside_range');
    }
  }
  return {
    key,
    status: reasons.length ? 'blocked' : 'ready',
    reasonCodes: reasons,
    assumption: reasons.length ? null : {
      key,
      source: 'user',
      value: entry.value,
      unit: entry.unit.trim(),
      range: { low: range.low, high: range.high },
      rationale: typeof entry.rationale === 'string' && entry.rationale.trim() ? entry.rationale.trim().slice(0, 1000) : null,
    },
  };
}

function verifiedBaselineCandidates(state, registration) {
  const measures = Array.isArray(state?.evidence?.package?.measures) ? state.evidence.package.measures : [];
  const requestedCounty = state?.place?.countyFips || state?.task?.countyFips || null;
  return measures.filter((measure) => {
    const semantics = measure?.semantics;
    const geography = measure?.geography;
    const sourceVersion = measure?.source_version;
    return semantics
      && geography
      && sourceVersion
      && semantics.source_measure_id === registration.inputSourceMeasureId
      && measure.review_status === 'verified'
      && semantics.review_status === 'verified'
      && geography.review_status === 'verified'
      && sourceVersion.review_status === 'verified'
      && semantics.forecastable === true
      && geography.kind === 'county'
      && (!requestedCounty || geography.county_fips === requestedCounty)
      && finite(measure.numeric_value);
  });
}

function scenarioValue(method, baseline, assumption) {
  if (method === 'absolute_change') return baseline + assumption;
  if (method === 'relative_fraction') return baseline * (1 + assumption);
  return baseline * (1 + (assumption / 100));
}

function withinMetricDomain(unit, value) {
  if (!finite(value)) return false;
  if (unit === 'percent') return value >= 0 && value <= 100;
  return true;
}

function baselineObservationEnd(measure) {
  return measure?.data_period_end
    || measure?.data_period_start
    || measure?.source_version?.data_period_end
    || measure?.source_version?.data_period_start
    || measure?.source_version?.release_date
    || null;
}

function evaluateAssumption(state, normalized, registration, context) {
  const reasons = [...normalized.reasonCodes];
  if (normalized.status !== 'ready') {
    return { key: normalized.key, status: 'blocked', reasonCodes: [...new Set(reasons)].sort() };
  }
  if (!registration) {
    return { key: normalized.key, status: 'blocked', reasonCodes: ['assumption_not_registered'] };
  }
  if (registration.reviewStatus !== 'verified') reasons.push('scenario_model_not_verified');
  if (normalized.assumption.unit !== registration.assumptionUnit) reasons.push('assumption_unit_mismatch');

  const candidates = verifiedBaselineCandidates(state, registration);
  if (candidates.length === 0) reasons.push('verified_forecastable_baseline_unavailable');
  if (candidates.length > 1) reasons.push('multiple_verified_baselines');
  const baseline = candidates.length === 1 ? candidates[0] : null;

  if (baseline) {
    if (!registration.allowedSourceIds.includes(baseline.source_version.source_id)) {
      reasons.push('baseline_source_not_registered');
    }
    const observationEnd = baselineObservationEnd(baseline);
    if (!observationEnd || !/^\d{4}-\d{2}-\d{2}/.test(observationEnd)) {
      reasons.push('baseline_period_unavailable');
    } else if (observationEnd.slice(0, 10) > context.asOf) {
      reasons.push('baseline_period_after_as_of');
    }
    const retrievedAt = baseline.source_version?.retrieved_at;
    if (!retrievedAt || !Number.isFinite(Date.parse(retrievedAt))) {
      reasons.push('baseline_retrieval_time_unavailable');
    } else if (new Date(retrievedAt).toISOString().slice(0, 10) > context.asOf) {
      reasons.push('baseline_retrieved_after_as_of');
    }
    if (registration.method === 'absolute_change' && normalized.assumption.unit !== baseline.semantics.unit) {
      reasons.push('absolute_change_unit_mismatch');
    }
  }

  const horizonDays = daysBetween(context.asOf, context.horizonEnd);
  if (horizonDays <= 0) reasons.push('scenario_horizon_not_future');
  if (horizonDays > registration.maximumHorizonDays) reasons.push('scenario_horizon_exceeds_model');

  if (reasons.length) {
    return {
      key: normalized.key,
      status: 'blocked',
      modelRegistrationId: registration.id,
      reasonCodes: [...new Set(reasons)].sort(),
    };
  }

  const baselineValue = baseline.numeric_value;
  const pointEstimate = scenarioValue(registration.method, baselineValue, normalized.assumption.value);
  const intervalLow = scenarioValue(registration.method, baselineValue, normalized.assumption.range.low);
  const intervalHigh = scenarioValue(registration.method, baselineValue, normalized.assumption.range.high);
  const low = Math.min(intervalLow, intervalHigh);
  const high = Math.max(intervalLow, intervalHigh);
  const unit = baseline.semantics.unit;
  if (![pointEstimate, low, high].every((value) => withinMetricDomain(unit, value))) {
    return {
      key: normalized.key,
      status: 'blocked',
      modelRegistrationId: registration.id,
      reasonCodes: ['scenario_result_outside_metric_domain'],
    };
  }

  const formula = registration.method === 'absolute_change'
    ? 'baseline + user_assumption'
    : registration.method === 'relative_fraction'
      ? 'baseline * (1 + user_assumption)'
      : 'baseline * (1 + user_assumption / 100)';

  return {
    key: normalized.key,
    status: 'ready',
    reasonCodes: [],
    model: {
      registrationId: registration.id,
      modelVersion: registration.modelVersion,
      methodVersion: registration.methodVersion,
      method: registration.method,
      formula,
      approvedBy: registration.approvedBy,
      approvedAt: registration.approvedAt,
    },
    assumption: clone(normalized.assumption),
    baseline: {
      measureId: baseline.id,
      semanticsId: baseline.semantics.id,
      sourceMeasureId: baseline.semantics.source_measure_id,
      sourceId: baseline.source_version.source_id,
      sourceVersionId: baseline.source_version.source_version_id,
      value: baselineValue,
      unit,
      dataPeriodEnd: baselineObservationEnd(baseline)?.slice(0, 10) || null,
    },
    output: {
      key: registration.outputKey,
      label: registration.outputLabel,
      value: pointEstimate,
      unit,
      range: { low, high },
      evidenceState: 'scenario_output',
      probability: null,
    },
  };
}

function createGovernedScenarioHandler(options = {}) {
  const registrations = Array.isArray(options.registrations)
    ? options.registrations.map(normalizeRegistration)
    : [];
  if (registrations.length === 0) throw new Error('Governed scenario handler requires at least one model registration.');
  const byAssumption = new Map();
  for (const registration of registrations) {
    if (byAssumption.has(registration.assumptionKey)) {
      throw new Error(`Duplicate scenario registration for assumption ${registration.assumptionKey}.`);
    }
    byAssumption.set(registration.assumptionKey, registration);
  }
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date();

  return async function governedScenarioHandler(state, assumptions) {
    const reasonCodes = [];
    if (!hasUserAssumptions(assumptions)) reasonCodes.push('explicit_user_assumptions_required');
    const countyFips = state?.place?.countyFips || state?.task?.countyFips || null;
    if (!COUNTY_FIPS.test(String(countyFips || ''))) reasonCodes.push('exact_county_required');
    const releaseId = state?.evidence?.releaseId;
    const releaseHash = state?.evidence?.releaseHash;
    if (typeof releaseId !== 'string' || !releaseId.trim()) reasonCodes.push('evidence_release_required');
    if (typeof releaseHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(releaseHash)) reasonCodes.push('evidence_release_hash_required');

    let asOf;
    let horizonEnd;
    try {
      const configuredAsOf = state?.task?.scenario?.asOf;
      asOf = dateOnly(configuredAsOf || clock().toISOString().slice(0, 10), 'scenario asOf');
    } catch {
      reasonCodes.push('scenario_as_of_invalid');
    }
    try {
      horizonEnd = dateOnly(state?.task?.scenario?.horizonEnd, 'scenario horizonEnd');
    } catch {
      reasonCodes.push('scenario_horizon_required');
    }

    const normalized = Object.entries(assumptions || {}).map(([key, entry]) => normalizeAssumption(key, entry));
    const contextReady = asOf && horizonEnd;
    const evaluations = contextReady
      ? normalized.map((entry) => evaluateAssumption(state, entry, byAssumption.get(entry.key), { asOf, horizonEnd }))
      : normalized.map((entry) => ({ key: entry.key, status: 'blocked', reasonCodes: ['scenario_context_invalid'] }));
    for (const evaluation of evaluations) reasonCodes.push(...evaluation.reasonCodes);

    const blocked = reasonCodes.length > 0 || evaluations.some((item) => item.status !== 'ready');
    const readyEvaluations = evaluations.filter((item) => item.status === 'ready');

    return {
      contract: SCENARIO_CONTRACT,
      status: 'scenario_output',
      evaluationStatus: blocked ? 'blocked' : 'ready',
      scenarioType: 'deterministic_planning_sensitivity',
      evidenceState: 'scenario_output',
      countyFips: countyFips || null,
      evidenceRelease: releaseId && releaseHash ? { releaseId, releaseHash } : null,
      asOf: asOf || null,
      horizonEnd: horizonEnd || null,
      assumptions: normalized.filter((item) => item.assumption).map((item) => clone(item.assumption)),
      evaluations: clone(evaluations),
      outputs: blocked ? [] : readyEvaluations.map((item) => clone(item.output)),
      reasonCodes: [...new Set(reasonCodes)].sort(),
      limitations: [
        'This is a deterministic planning sensitivity, not a statistical prediction or published estimate.',
        'The output changes only the stated user assumptions and registered method; secondary effects are not inferred.',
        'The scenario carries no probability of occurrence and cannot determine an official priority, funding decision, or resource allocation.',
        'Human review is required before any scenario is used in a consequential planning artifact.',
      ],
      officialEstimate: false,
      statisticalPrediction: false,
      probabilityOfOccurrence: null,
      humanReviewRequired: true,
    };
  };
}

module.exports = {
  ALLOWED_METHODS,
  SCENARIO_CONTRACT,
  createGovernedScenarioHandler,
  normalizeRegistration,
};
