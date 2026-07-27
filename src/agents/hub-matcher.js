/**
 * Hub Matching Agent
 *
 * Given barrier scores and local context, recommends the most appropriate
 * Health Equity Hub format (Library, Community, or Home) and surfaces
 * supporting rationale.
 *
 * Designed to be called by other agents or by the frontend after place analysis.
 */

class HubMatcher {
  /**
   * @param {object} barriers - key/value barrier pressure scores (0-100)
   * @param {object} context  - optional local signals
   * @returns {Array} ranked hub recommendations
   */
  match(barriers = {}, context = {}) {
    const scores = {
      Library: 0,
      Community: 0,
      Home: 0
    };

    // Simple deterministic scoring for demonstration.
    // Production version will incorporate richer local configuration.
    if (barriers.Technology >= 50) scores.Library += 30;
    if (barriers.Transportation >= 60) scores.Home += 35;
    if (barriers.Language >= 40) scores.Community += 20;
    if (barriers.Workforce >= 50) scores.Community += 15;

    // Baseline presence of trusted public spaces
    scores.Library += 25;
    scores.Community += 20;
    scores.Home += 10;

    const ranked = Object.entries(scores)
      .map(([type, score]) => ({
        type,
        score,
        fit: score >= 50 ? "High" : score >= 30 ? "Medium" : "Low"
      }))
      .sort((a, b) => b.score - a.score);

    return ranked;
  }
}

module.exports = { HubMatcher };
