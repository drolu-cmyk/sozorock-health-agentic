/**
 * Hub Matching Agent
 * Deterministic rules that map barrier profiles to Library / Community / Home formats.
 */

class HubMatchingAgent {
  match(scores = {}, geo = {}) {
    const ranked = [];

    // Library: strong when technology or general access barriers are present
    let libraryScore = 40;
    if ((scores.Technology || 0) >= 50) libraryScore += 25;
    if ((scores.Transportation || 0) >= 40) libraryScore += 10;
    ranked.push({
      type: "Library",
      fit: fitLabel(libraryScore),
      score: libraryScore,
      reason: "Trusted public starting point with digital readiness support"
    });

    // Community: strong when language or workforce signals appear
    let communityScore = 35;
    if ((scores.Language || 0) >= 30) communityScore += 20;
    if ((scores.Workforce || 0) >= 50) communityScore += 15;
    ranked.push({
      type: "Community",
      fit: fitLabel(communityScore),
      score: communityScore,
      reason: "Neutral community spaces for education, support, and field activation"
    });

    // Home: strong when transportation or mobility barriers dominate
    let homeScore = 30;
    if ((scores.Transportation || 0) >= 60) homeScore += 35;
    if ((scores.Technology || 0) >= 55) homeScore += 10;
    ranked.push({
      type: "Home",
      fit: fitLabel(homeScore),
      score: homeScore,
      reason: "Configured pathway for residents facing mobility or travel barriers"
    });

    return ranked.sort((a, b) => b.score - a.score);
  }
}

function fitLabel(score) {
  if (score >= 60) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

module.exports = { HubMatchingAgent };
