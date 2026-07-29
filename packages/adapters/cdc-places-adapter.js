/**
 * CDC PLACES County Adapter
 *
 * Production: fetch from CDC PLACES API or bulk county release file.
 * Current: snapshot mode for counties present in local snapshot file or seed.
 *
 * Every signal includes source table, field, release, geography, transformation, retrievedAt.
 */

const fs = require("fs");
const path = require("path");
const { BaseAdapter } = require("./base-adapter");

class CdcPlacesAdapter extends BaseAdapter {
  constructor() {
    super({ name: "cdc-places", version: "0.5.0" });
    this._snapshot = null;
  }

  _loadSnapshot() {
    if (this._snapshot) return this._snapshot;
    const p = path.join(__dirname, "../data/snapshots/cdc-places-county.json");
    try {
      if (fs.existsSync(p)) {
        this._snapshot = JSON.parse(fs.readFileSync(p, "utf8"));
        return this._snapshot;
      }
    } catch (e) {}
    // Minimal seed for development — not a national release
    this._snapshot = {
      release: "2025-12-04",
      version: "seed-dev",
      counties: {
        "36095": {
          ACCESS2_CrudePrev: 12.4,
          CSMOKING_CrudePrev: 18.1,
          OBESITY_CrudePrev: 34.2,
          BPHIGH_CrudePrev: 32.8
        },
        "36025": {
          ACCESS2_CrudePrev: 11.8,
          CSMOKING_CrudePrev: 17.5,
          OBESITY_CrudePrev: 33.1,
          BPHIGH_CrudePrev: 31.9
        }
      }
    };
    return this._snapshot;
  }

  async fetchForCounty(fips) {
    const key = String(fips).padStart(5, "0");
    const snap = this._loadSnapshot();
    const row = snap.counties && snap.counties[key];
    if (!row) {
      return this.unavailable(`CDC PLACES snapshot has no row for FIPS ${key}. Load full release into packages/data/snapshots/cdc-places-county.json`);
    }

    const retrievedAt = new Date().toISOString();
    const release = snap.release || "unknown";
    const signals = [];

    if (row.ACCESS2_CrudePrev != null) {
      signals.push(this.signal("healthcare_access_barrier", row.ACCESS2_CrudePrev, {
        sourceTable: "CDC_PLACES_COUNTY",
        sourceField: "ACCESS2_CrudePrev",
        release,
        geography: key,
        transformation: "direct_crude_prevalence",
        retrievedAt,
        citation: "CDC PLACES: Local Data for Better Health, county release"
      }));
    }
    if (row.OBESITY_CrudePrev != null) {
      signals.push(this.signal("obesity_prevalence", row.OBESITY_CrudePrev, {
        sourceTable: "CDC_PLACES_COUNTY",
        sourceField: "OBESITY_CrudePrev",
        release,
        geography: key,
        transformation: "direct_crude_prevalence",
        retrievedAt,
        citation: "CDC PLACES: Local Data for Better Health, county release"
      }));
    }

    return {
      status: snap.version === "seed-dev" ? "snapshot" : "available",
      signals,
      meta: {
        adapter: this.name,
        version: this.version,
        release,
        snapshotVersion: snap.version
      }
    };
  }
}

module.exports = { CdcPlacesAdapter };
