const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { scoreBarriers, WEIGHTS } = require("../packages/core/barrier-scoring");

describe("Barrier scoring", () => {
  it("returns scores and sparse-safe methodology", () => {
    const result = scoreBarriers({
      transportation: 70,
      technology: 50,
      workforce: 60,
      cost: 40,
      language: 20
    });
    assert.ok(result.scores);
    assert.ok(result.methodology);
    assert.equal(result.methodology.version, "1.1");
    assert.ok(typeof result.composite === "number");
  });

  it("keeps missing dimensions null and renormalizes over source-backed inputs", () => {
    const result = scoreBarriers({ transportation: 80, workforce: 40 });
    assert.equal(result.scores.Transportation, 80);
    assert.equal(result.scores.Workforce, 40);
    assert.equal(result.scores.Technology, null);
    assert.equal(result.scores.Cost, null);
    assert.equal(result.scores.Language, null);
    assert.equal(result.methodology.weightSum, 0.55);
    assert.deepEqual(result.methodology.weightsUsed, {
      transportation: 0.30,
      workforce: 0.25
    });
    assert.equal(result.composite, 61.8);
  });

  it("clamps values to 0-100", () => {
    const result = scoreBarriers({ transportation: 150, technology: -10 });
    assert.equal(result.scores.Transportation, 100);
    assert.equal(result.scores.Technology, 0);
  });

  it("weights sum to 1", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 0.001);
  });
});
