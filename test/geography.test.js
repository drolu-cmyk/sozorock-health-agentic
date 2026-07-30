const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getByFips, resolveByName } = require("../packages/data/national-counties");
const { resolveZip } = require("../packages/data/zip-crosswalk");
const { GeographyAgent } = require("../packages/agents/sub-agents/geography-agent");

describe("National county table", () => {
  it("resolves Schoharie FIPS", () => {
    const g = getByFips("36095");
    assert.equal(g.name, "Schoharie");
    assert.equal(g.state, "NY");
  });

  it("resolves multi-state counties", () => {
    assert.equal(getByFips("06037").name, "Los Angeles");
    assert.equal(getByFips("48201").name, "Harris");
    assert.equal(getByFips("11001").state, "DC");
  });

  it("resolves by name and state", () => {
    const g = resolveByName("King", "WA");
    assert.equal(g.fips, "53033");
  });
});

describe("ZIP crosswalk", () => {
  it("resolves primary county for ZIP", () => {
    const r = resolveZip("12043");
    assert.equal(r.primary.fips, "36095");
    assert.equal(r.multiCounty, false);
  });

  it("flags multi-county ZIPs", () => {
    const r = resolveZip("12566");
    assert.equal(r.multiCounty, true);
    assert.ok(r.all.length >= 2);
  });

  it("returns null for unknown ZIP", () => {
    assert.equal(resolveZip("99999"), null);
  });
});

describe("Geography agent", () => {
  const agent = new GeographyAgent();

  it("resolves ZIP via crosswalk", async () => {
    const g = await agent.resolve("94102");
    assert.equal(g.fips, "06075");
    assert.equal(g.county, "San Francisco");
    assert.equal(g.resolvedAs, "zip");
  });

  it("resolves five-digit FIPS before treating as ZIP", async () => {
    const g = await agent.resolve("17031");
    assert.ok(g);
    assert.equal(g.county, "Cook");
    assert.equal(g.state, "IL");
    assert.equal(g.resolvedAs, "fips");
  });

  it("resolves Schoharie FIPS", async () => {
    const g = await agent.resolve("36095");
    assert.equal(g.county, "Schoharie");
    assert.equal(g.resolvedAs, "fips");
  });

  it("returns null for unknown five-digit", async () => {
    assert.equal(await agent.resolve("99999"), null);
  });

  it("resolves name with state", async () => {
    const g = await agent.resolve("King, WA");
    assert.equal(g.fips, "53033");
  });
});
