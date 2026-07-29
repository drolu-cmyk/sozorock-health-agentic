/**
 * Geography Agent
 *
 * Resolves ZIP, FIPS, or county+state to a canonical record.
 * Uses national county table + ZIP crosswalk.
 * Multi-county ZIPs return primary county and flag multiCounty.
 */

const { getByFips, resolveByName } = require("../../data/national-counties");
const { resolveZip } = require("../../data/zip-crosswalk");

class GeographyAgent {
  async resolve(query) {
    if (!query) return null;
    const q = String(query).trim();

    // ZIP
    if (/^\d{5}$/.test(q)) {
      const zipResult = resolveZip(q);
      if (!zipResult) return null;
      const primary = zipResult.primary;
      const c = primary.county;
      return {
        fips: primary.fips,
        county: c.name || null,
        state: c.state || null,
        zcta: q,
        lat: c.lat || null,
        lng: c.lng || null,
        multiCounty: zipResult.multiCounty,
        allCounties: zipResult.multiCounty
          ? zipResult.all.map(a => ({ fips: a.fips, name: a.county.name, resRatio: a.resRatio }))
          : undefined
      };
    }

    // FIPS
    if (/^\d{5}$/.test(q) || /^\d{4,5}$/.test(q)) {
      const rec = getByFips(q);
      if (rec) {
        return {
          fips: rec.fips,
          county: rec.name,
          state: rec.state,
          lat: rec.lat,
          lng: rec.lng,
          multiCounty: false
        };
      }
    }

    // "County, ST" or "County County ST"
    const m = q.match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
    if (m) {
      const rec = resolveByName(m[1], m[2]);
      if (rec) {
        return {
          fips: rec.fips,
          county: rec.name,
          state: rec.state,
          lat: rec.lat,
          lng: rec.lng,
          multiCounty: false
        };
      }
    }

    // Name only (ambiguous if multiple states share name)
    const rec = resolveByName(q, null);
    if (rec) {
      return {
        fips: rec.fips,
        county: rec.name,
        state: rec.state,
        lat: rec.lat,
        lng: rec.lng,
        multiCounty: false
      };
    }

    // Legacy string hints for demo ZIPs
    const lower = q.toLowerCase();
    if (lower.includes("schoharie") || lower.includes("cobleskill")) {
      return this.resolve("36095");
    }
    if (lower.includes("delaware") && (lower.includes("ny") || lower.includes("new york"))) {
      return this.resolve("36025");
    }

    return null;
  }
}

module.exports = { GeographyAgent };
