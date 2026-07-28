const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { ComplianceAgent } = require("../packages/agents/sub-agents/compliance-agent");

const agent = new ComplianceAgent();

describe("Compliance agent", () => {
  it("accepts a clean package", () => {
    const pkg = {
      brief: { context: "Rural access planning support" },
      evidence: {
        sources: [{
          citation: "CDC PLACES 2025",
          releaseDate: "2025-12-04"
        }],
        freshness: "2025-12-04"
      },
      meta: {
        nonClinical: true,
        sourceTraceable: true,
        sourceFreshness: "2025-12-04"
      }
    };
    const result = agent.check(pkg);
    assert.equal(result.ok, true);
  });

  it("blocks clinical language", () => {
    const pkg = {
      brief: { context: "This diagnosis requires treatment" },
      evidence: {
        sources: [{ citation: "x", releaseDate: "2025-01-01" }],
        freshness: "2025-01-01"
      },
      meta: { nonClinical: true, sourceTraceable: true, sourceFreshness: "2025-01-01" }
    };
    const result = agent.check(pkg);
    assert.equal(result.ok, false);
    assert.ok(result.violations.some(v => /Clinical language/i.test(v)));
  });

  it("requires sources", () => {
    const pkg = {
      meta: { nonClinical: true, sourceTraceable: true, sourceFreshness: "2025-01-01" },
      evidence: { sources: [], freshness: "2025-01-01" }
    };
    const result = agent.check(pkg);
    assert.equal(result.ok, false);
  });

  it("requires freshness", () => {
    const pkg = {
      meta: { nonClinical: true, sourceTraceable: true },
      evidence: {
        sources: [{ citation: "x", releaseDate: "2025-01-01" }]
      }
    };
    const result = agent.check(pkg);
    assert.equal(result.ok, false);
  });
});
