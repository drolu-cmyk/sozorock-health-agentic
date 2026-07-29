/**
 * Census ACS 5-Year County Adapter
 *
 * Maps ACS fields to planning indicators:
 * - No vehicle available (transportation barrier proxy)
 * - Broadband / computer access (technology barrier proxy)
 *
 * Production: Census API or bulk ACS download.
 * Current: snapshot file or seed for development counties only.
 */

const fs = require("fs");
const path = require("path");
const { BaseAdapter } = require("./base-adapter");

class AcsAdapter extends BaseAdapter {
  constructor() {
    super({ name: "acs-5yr", version: "0.5.0" });
    this._snapshot = null;
  }

  _loadSnapshot() {
    if (this._snapshot) return this._snapshot;
    const p = path.join(__dirname, "../data/snapshots/acs-county.json");
    try {
      if (fs.existsSync(p)) {
        this._snapshot = JSON.parse(fs.readFileSync(p, "utf8"));
        return this._snapshot;
      }
    } catch (e) {}
    this._snapshot = {
      release: "ACS 2019-2023",
      version: "seed-dev",
      counties: {
        "36095": { no_vehicle_pct: 7.2, broadband_pct: 78.4 },
        "36025": { no_vehicle_pct: 6.8, broadband_pct: 80.1 }
      }
    };
    return this._snapshot;
  }

  async fetchForCounty(fips) {
    const key = String(fips).padStart(5, "0");
    const snap = this._loadSnapshot();
    const row = snap.counties && snap.counties[key];
    if (!row) {
      return this.unavailable(`ACS snapshot has no row for FIPS ${key}. Load ACS extract into packages/data/snapshots/acs-county.json`);
    }

    const retrievedAt = new Date().toISOString();
    const release = snap.release || "unknown";
    const signals = [];

    if (row.no_vehicle_pct != null) {
      signals.push(this.signal("no_vehicle_pct", row.no_vehicle_pct, {
        sourceTable: "ACS_5YR_B08201",
        sourceField: "B08201_002E_share",
        release,
        geography: key,
        transformation: "percent_of_occupied_units_no_vehicle",
        retrievedAt,
        citation: "U.S. Census Bureau, American Community Survey 5-year estimates"
      }));
    }
    if (row.broadband_pct != null) {
      signals.push(this.signal("broadband_subscription_pct", row.broadband_pct, {
        sourceTable: "ACS_5YR_S2801",
        sourceField: "S2801_C01_014E",
        release,
        geography: key,
        transformation: "direct_percent",
        retrievedAt,
        citation: "U.S. Census Bureau, American Community Survey 5-year estimates"
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

module.exports = { AcsAdapter };
