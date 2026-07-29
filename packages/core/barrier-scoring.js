/**
 * Transparent Barrier Scoring
 *
 * Deterministic, explainable calculations.
 * Sparse indicators: only dimensions with numeric values participate in the composite.
 * Weights are renormalized over available dimensions.
 */

const WEIGHTS = {
  transportation: 0.30,
  technology: 0.20,
  workforce: 0.25,
  cost: 0.15,
  language: 0.10
};

function scoreBarriers(indicators = {}) {
  const scores = {};
  const usedWeights = {};
  let weightSum = 0;

  for (const [key, weight] of Object.entries(WEIGHTS)) {
    // Map to display key (capitalize)
    const displayKey = key.charAt(0).toUpperCase() + key.slice(1);
    const raw = indicators[key];
    if (raw == null || Number.isNaN(Number(raw))) {
      scores[displayKey] = null;
      continue;
    }
    const v = clamp(raw);
    scores[displayKey] = v;
    usedWeights[key] = weight;
    weightSum += weight;
  }

  let composite = null;
  if (weightSum > 0) {
    composite = 0;
    for (const [key, weight] of Object.entries(usedWeights)) {
      const displayKey = key.charAt(0).toUpperCase() + key.slice(1);
      composite += scores[displayKey] * (weight / weightSum);
    }
    composite = Math.round(composite * 10) / 10;
  }

  return {
    scores,
    composite,
    methodology: {
      version: "1.1",
      weights: { ...WEIGHTS },
      weightsUsed: usedWeights,
      weightSum,
      description: "Weighted average over available source-backed indicators only. Missing dimensions are null and excluded from composite.",
      inputsUsed: Object.keys(indicators).filter(k => indicators[k] != null)
    }
  };
}

function clamp(v) {
  return Math.max(0, Math.min(100, Number(v) || 0));
}

module.exports = {
  scoreBarriers,
  WEIGHTS
};
