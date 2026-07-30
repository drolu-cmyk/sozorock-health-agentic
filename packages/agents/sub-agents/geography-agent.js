/**
 * Geography Agent
 *
 * Resolution order for five-digit input:
 *   1. National county table as FIPS
 *   2. ZIP crosswalk
 *   3. null (fail closed)
 *
 * County name without state:
 *   Returns ambiguity object when multiple states share the name.
 */

const { getByFips, resolveByName, getTable } = require("../../data/national-counties");
const { resolveZip } = require("../../data/zip-crosswalk");

class GeographyAgent {
  async resolve(query) {
    if (!query) return null;
    const q = String(query).trim();

    // Five-digit: FIPS first, then ZIP
    if (/^\d{5}$/.test(q)) {
      const asFips = getByFips(q);
      if (asFips) {
        return {
          fips: asFips.fips,
          county: asFips.name,
          state: asFips.state,
          lat: asFips.lat,
          lng: asFips.lng,
          multiCounty: false,
          resolvedAs: "fips"
        };
      }

      const zipResult = resolveZip(q);
      if (zipResult) {
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
            ? zipResult.all.map(a => ({
                fips: a.fips,
                name: a.county && a.county.name,
                resRatio: a.resRatio
              }))
            : undefined,
          resolvedAs: "zip"
        };
      }

      return null;
    }

    // "County, ST" or "Name ST"
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
          multiCounty: false,
          resolvedAs: "name_state"
        };
      }
      return null;
    }

    // Name only — detect ambiguity across states
    const matches = findAllByName(q);
    if (matches.length === 1) {
      const rec = matches[0];
      return {
        fips: rec.fips,
        county: rec.name,
        state: rec.state,
        lat: rec.lat,
        lng: rec.lng,
        multiCounty: false,
        resolvedAs: "name"
      };
    }
    if (matches.length > 1) {
      return {
        status: "ambiguous",
        message: "Multiple counties match this name. Specify state (e.g. \"Orange, CA\").",
        matches: matches.map(r => ({
          fips: r.fips,
          county: r.name,
          state: r.state
        }))
      };
    }

    // Legacy demo hints
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

function findAllByName(name) {
  if (!name) return [];
  const n = String(name).toLowerCase().replace(/\s+county$/i, "").trim();
  const out = [];
  for (const rec of Object.values(getTable())) {
    if (rec.name && rec.name.toLowerCase() === n) out.push(rec);
  }
  return out;
}

module.exports = { GeographyAgent };
