/**
 * Transparent Barrier Scoring
 *
 * Deterministic, explainable calculations.
 * Every score carries its methodology and source inputs so results are auditable.
 *
 * Methodology (v1):
 *   Composite = weighted average of normalized public indicators.
 *   Weights are fixed and published. No black-box models.
 */

const WEIGHTS = {
  transportation: 0.30,
  technology: 0.20,
  workforce: 0.25,
  cost: 0.15,
  language: 0.10
};

/**
 * Calculate barrier scores from public indicators.
 * @param {object} indicators - raw public values (0-100 normalized)
 * @returns {object} scored result with methodology
 */
function scoreBarriers(indicators = {}) {
  const scores = {
    Transportation: clamp(indicators.transportation ?? 40),
    Technology: clamp(indicators.technology ?? 35),
    Workforce: clamp(indicators.workforce ?? 45),
    Cost: clamp(indicators.cost ?? 50),
    Language: clamp(indicators.language ?? 20)
  };

  const composite =
    scores.Transportation * WEIGHTS.transportation +
    scores.Technology * WEIGHTS.technology +
    scores.Workforce * WEIGHTS.workforce +
    scores.Cost * WEIGHTS.cost +
    scores.Language * WEIGHTS.language;

  return {
    scores,
    composite: Math.round(composite * 10) / 10,
    methodology: {
      version: "1.0",
      weights: { ...WEIGHTS },
      description: "Weighted average of normalized public indicators. Higher = greater practical barrier pressure.",
      inputsUsed: Object.keys(indicators)
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
