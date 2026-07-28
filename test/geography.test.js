const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveGeography } = require("../packages/data/zip-to-fips");

describe("Geography resolution", () => {
  it("resolves known Schoharie ZIP", () => {
    const g = resolveGeography("12043");
    assert.equal(g.fips, "36095");
    assert.equal(g.county, "Schoharie");
    assert.equal(g.state, "NY");
  });

  it("resolves known Delaware ZIP", () => {
    const g = resolveGeography("13753");
    assert.equal(g.fips, "36025");
    assert.equal(g.county, "Delaware");
  });

  it("resolves county name", () => {
    const g = resolveGeography("Schoharie County");
    assert.equal(g.fips, "36095");
  });

  it("returns null for unknown ZIP", () => {
    const g = resolveGeography("99999");
    assert.equal(g, null);
  });

  it("returns null for empty input", () => {
    assert.equal(resolveGeography(""), null);
    assert.equal(resolveGeography(null), null);
  });
});
