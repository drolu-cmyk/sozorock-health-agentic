/**
 * Barrier Agent
 * Produces deterministic, explainable barrier scores.
 */

const { scoreBarriers } = require("../../core/barrier-scoring");

class BarrierAgent {
  score(indicators) {
    return scoreBarriers(indicators);
  }
}

module.exports = { BarrierAgent };
