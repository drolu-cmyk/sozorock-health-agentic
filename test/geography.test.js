const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getByFips,
  getMeta: getCountyMeta,
  loadCountyArtifact,
  resolveByName,
  validateCountyArtifact,
} = require("../packages/data/national-counties");
const {
  getMeta: getZipMeta,
  loadZipArtifact,
  resolveZip,
  validateZctaProxyArtifact,
  validateZipArtifact,
  ZCTA_CAVEAT,
} = require("../packages/data/zip-crosswalk");
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

  it("loads all Census counties and county equivalents with governed provenance", () => {
    const meta = getCountyMeta();
    assert.equal(meta.count, 3144);
    assert.equal(meta.stateCount, 51);
    assert.equal(meta.coverageReady, true);
    assert.equal(meta.sourceProvenance.url, "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip");
    assert.match(meta.sourceProvenance.sha256, /^[0-9a-f]{64}$/);
  });

  it("contains the evaluation counties and representatives across the nation", () => {
    const expected = {
      "36057": ["Montgomery", "NY"],
      "42029": ["Chester", "PA"],
      "06037": ["Los Angeles", "CA"],
      "17031": ["Cook", "IL"],
      "48201": ["Harris", "TX"],
      "53033": ["King", "WA"],
      "11001": ["District of Columbia", "DC"],
    };
    for (const [fips, [name, state]] of Object.entries(expected)) {
      assert.deepEqual([getByFips(fips).name, getByFips(fips).state], [name, state]);
    }
  });

  it("fails national validation when coverage drops below the threshold", () => {
    const artifact = structuredClone(loadCountyArtifact({ production: true }).artifact);
    artifact.counties = { "36057": artifact.counties["36057"], "42029": artifact.counties["42029"] };
    const result = validateCountyArtifact(artifact, { requireNational: true });
    assert.equal(result.ok, false);
    assert.ok(result.issues.includes("county_coverage_below_threshold:2"));
  });

  it("resolves by name and state", () => {
    const g = resolveByName("King", "WA");
    assert.equal(g.fips, "53033");
  });
});

describe("Postal input county selection", () => {
  it("resolves a postal input through the same-numbered Census ZCTA proxy", () => {
    const r = resolveZip("12043");
    assert.equal(r.primary.fips, "36095");
    assert.equal(r.multiCounty, true);
    assert.equal(r.method, "census_zcta_proxy");
    assert.equal(r.resolvedGeographyKind, "census_zcta_proxy");
    assert.equal(r.caveat, ZCTA_CAVEAT);
  });

  it("flags multi-county ZIPs", () => {
    const r = resolveZip("12566");
    assert.equal(r.multiCounty, true);
    assert.deepEqual(r.all.map((entry) => entry.fips), ["36111", "36071", "36105"]);
    assert.equal(Number(r.all.reduce((sum, entry) => sum + entry.areaRatio, 0).toFixed(6)), 1);
  });

  it("returns null for unknown ZIP", () => {
    assert.equal(resolveZip("99999"), null);
  });

  it("loads the complete governed proxy and exposes its method and provenance", () => {
    const meta = getZipMeta();
    assert.equal(meta.coverageReady, true);
    assert.equal(meta.method, "census_zcta_proxy");
    assert.equal(meta.resolvedGeographyKind, "census_zcta_proxy");
    assert.equal(meta.count, 33354);
    assert.equal(meta.countyCount, 3135);
    assert.equal(meta.relationshipCount, 46641);
    assert.equal(meta.caveat, ZCTA_CAVEAT);
    assert.equal(loadZipArtifact({ production: true }).method, "census_zcta_proxy");
    assert.match(meta.sourceProvenance.sha256, /^[0-9a-f]{64}$/);
  });

  it("covers the evaluation counties and preserves zero-rounded sliver overlaps", () => {
    assert.equal(resolveZip("13410").primary.fips, "36057");
    assert.equal(resolveZip("19380").primary.fips, "42029");
    const sliver = resolveZip("13642").all.find((entry) => entry.fips === "36049");
    assert.ok(sliver);
    assert.equal(sliver.areaRatio, 0);
    assert.equal(sliver.landAreaSquareMeters, 29);
  });

  it("rejects orphan county relationships and incomplete national ZIP coverage", () => {
    const result = validateZipArtifact({
      effectiveDate: "2025-03-31",
      method: "hud_usps_zip_county",
      source: { url: "https://www.huduser.gov/portal/datasets/usps_crosswalk.html", sha256: "a".repeat(64) },
      zips: { "12345": [{ fips: "99999", resRatio: 1 }] },
    }, { requireNational: true, countyLookup: () => null });
    assert.equal(result.ok, false);
    assert.ok(result.issues.includes("county_reference_missing:12345:99999"));
    assert.ok(result.issues.includes("zip_coverage_below_threshold:1"));
  });

  it("rejects an incomplete or caveat-free Census proxy", () => {
    const result = validateZctaProxyArtifact({
      effectiveDate: "2025-01-01",
      vintage: "2025",
      method: "census_zcta_proxy",
      caveat: "ZIP equals ZCTA",
      source: { url: "https://www2.census.gov/geo/docs/maps-data/data/grfc/", sha256: "a".repeat(64), manifests: [] },
      zctas: { "13410": [{ fips: "99999", areaRatio: 1, landAreaSquareMeters: 1 }] },
    }, { requireNational: true, countyLookup: () => null });
    assert.equal(result.ok, false);
    assert.ok(result.issues.includes("zip_zcta_caveat_invalid"));
    assert.ok(result.issues.includes("census_source_manifests_incomplete"));
    assert.ok(result.issues.includes("county_reference_missing:13410:99999"));
  });
});

describe("Geography agent", () => {
  const agent = new GeographyAgent();

  it("labels Census ZCTA proxy resolution without claiming exact ZIP truth", async () => {
    const g = await agent.resolve("94102");
    assert.equal(g.fips, "06075");
    assert.equal(g.county, "San Francisco");
    assert.equal(g.resolvedAs, "census_zcta_proxy");
    assert.equal(g.resolutionMethod, "census_zcta_proxy");
    assert.equal(g.postalCodeInput, "94102");
    assert.equal(g.zcta, "94102");
    assert.match(g.caveat, /postal ZIP Code is not a Census ZCTA/i);
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

  it("does not convert a demo locality into a county", async () => {
    assert.equal(await agent.resolve("Cobleskill"), null);
  });

  it("does not use legacy free-text demo hints", async () => {
    assert.equal(await agent.resolve("Delaware New York"), null);
  });
});
