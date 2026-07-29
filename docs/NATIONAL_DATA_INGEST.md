# National Data Ingest

This document is the production path to full U.S. coverage.

## 1. National county / FIPS table

**Target file:** `packages/data/national-counties.full.json`

```json
{
  "version": "Census-YYYY",
  "effectiveDate": "YYYY-MM-DD",
  "counties": {
    "36095": {
      "fips": "36095",
      "name": "Schoharie",
      "state": "NY",
      "stateFips": "36",
      "type": "county",
      "lat": 42.68,
      "lng": -74.49
    }
  }
}
```

**Source:** Census county gazetteer or TIGER county centroids.  
**Loader:** `packages/data/national-counties.js` auto-loads this file when present.

## 2. HUD USPS ZIP–County Crosswalk

**Target file:** `packages/data/hud-zip-county.json`

```json
{
  "version": "HUD-2025-Q1",
  "effectiveDate": "2025-03-31",
  "zips": {
    "12043": [{ "fips": "36095", "resRatio": 1.0 }],
    "12566": [
      { "fips": "36071", "resRatio": 0.62 },
      { "fips": "36027", "resRatio": 0.38 }
    ]
  }
}
```

**Source:** HUD USPS ZIP Code Crosswalk files.  
**Loader:** `packages/data/zip-crosswalk.js`  
**Behavior:** Multi-county ZIPs return all counties; primary = highest `resRatio`.

## 3. CDC PLACES county release

**Target file:** `packages/data/snapshots/cdc-places-county.json`

Include at minimum fields mapped by `packages/adapters/cdc-places-adapter.js`  
(e.g. `ACCESS2_CrudePrev`, `OBESITY_CrudePrev`).

Every derived signal records: sourceTable, sourceField, release, geography, transformation, retrievedAt.

## 4. ACS 5-year county extract

**Target file:** `packages/data/snapshots/acs-county.json`

Include fields mapped by `packages/adapters/acs-adapter.js`  
(e.g. no-vehicle share, broadband subscription rate).

## 5. Census boundaries (map)

Not yet wired. Next step: GeoJSON county boundaries from TIGER, served as static tiles or simplified polygons keyed by FIPS.

## 6. Automated refresh jobs

Planned (not yet scheduled):

| Job | Cadence | Action |
|-----|---------|--------|
| `jobs/refresh-places.js` | On CDC release | Download + validate + write snapshot |
| `jobs/refresh-acs.js` | Annual ACS | Download + validate + write snapshot |
| `jobs/validate-lineage.js` | On deploy | Fail if any signal lacks lineage |
| `jobs/validate-geography.js` | On crosswalk update | Check FIPS referential integrity |

## 7. Failure policy

- Unknown ZIP/FIPS → clear error, no invented geography
- County resolved but no indicator snapshot → plan scaffold with `dataNature: "none"`
- Never display a barrier score without lineage

## Current seed coverage

Until full files are loaded:
- Multi-state county seed (~25 counties across NY, CA, TX, FL, IL, PA, OH, GA, WA, AZ, MA, CO, DC)
- Sample ZIPs for those areas
- PLACES + ACS snapshot rows for Schoharie and Delaware NY only
