# National geography ingestion

CB-CAP resolves planning geography against governed, immutable inputs:

1. the annual U.S. Census Bureau county Gazetteer for canonical county and county-equivalent identity; and
2. either the quarterly HUD USPS ZIP Code Crosswalk for postal ZIP relationships or the approved Census current ZCTA-to-county proxy.

Postal ZIP Codes are not Census ZCTAs. Both can cross county boundaries. The runtime retains every published overlap and exposes the active method. With HUD it selects by residential ratio, falling back to total-address ratio. With Census it selects a same-numbered ZCTA by land-area overlap only for county-selection context. It never describes that proxy as exact USPS ZIP geography and never uses a centroid or hand-maintained locality hint.

## Governed sources

| Artifact | Authoritative source | Runtime file | Production minimum |
| --- | --- | --- | --- |
| Census counties | `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip` | `packages/data/national-counties.full.json` | 3,144 counties/equivalents across 50 states and DC |
| HUD USPS ZIP-county | `https://www.huduser.gov/portal/datasets/usps_crosswalk.html` | `packages/data/hud-zip-county.json` | 30,000 ZIPs and 3,000 referenced counties |
| Census ZCTA proxy | `https://www2.census.gov/geo/docs/maps-data/data/grfc/` | `packages/data/census-zcta-county-proxy.json.gz` | 33,000 ZCTAs, 3,100 counties, and 46,000 preserved overlaps; gzip packaging is decoded before validation |

The committed Census runtime artifact is derived from the complete Census 2025 county index in `sozorock-health`. Its manifest preserves the checksum of the original Census ZIP, the checksum of the imported county index, the upstream content checksum, source URL, vintage, and release date. The generated file SHA-256 is `23007ba58afe20c0ef256ce5e479a66f81e803000eecc357b197a44871350fc2`.

HUD distributes the USPS crosswalk under its own data-use terms and access workflow. Do not substitute a community ZIP list, geocoder, or synthetic ZIP assignment when a current HUD export is unavailable. Production may instead use the governed Census proxy below, with its mandatory ZIP-not-ZCTA caveat and method identity.

## Reproducible county generation

The generator does not fetch data and accepts only explicit immutable inputs. Download and retain the official Census ZIP, verify its checksum, extract the tab-delimited Gazetteer member, then run:

```bash
node scripts/build-national-geography.js \
  --census-gazetteer /immutable/2025_Gaz_counties_national.txt \
  --source-sha256 4c90d0f805779923b5958ab13d0c1e9b99fe4932b786bfcf75dd739bb2dcb4ea \
  --vintage 2025 \
  --effective-date 2025-01-01 \
  --generated-at 2026-07-23T18:25:59.651Z
```

When direct authoritative download is unavailable, the approved sister-repository fallback is reproducible with its manifest:

```bash
node scripts/build-national-geography.js \
  --county-index /workspace/sozorock-health/packages/evidence-core/data/national/county-index.v2025.json \
  --source-manifest /workspace/sozorock-health/packages/evidence-core/data/national/import-manifest.v2025.json \
  --vintage 2025 \
  --effective-date 2025-01-01 \
  --generated-at 2026-07-23T18:25:59.651Z
```

The build rejects malformed GEOIDs, state mismatches, invalid coordinates, missing Montgomery County NY (`36057`) or Chester County PA (`42029`), fewer than 3,144 county equivalents, or fewer than 51 state/DC jurisdictions.

## Reproducible HUD generation

Export the complete HUD ZIP-county CSV with the standard `ZIP`, `COUNTY`, `RES_RATIO`, and `TOT_RATIO` columns. Retain the unmodified source file, release label, download date, and terms applicable to the export. Then run:

```bash
node scripts/build-national-geography.js \
  --hud-csv /immutable/ZIP_COUNTY_2026_Q2.csv \
  --release HUD-2026-Q2 \
  --effective-date 2026-06-30 \
  --generated-at 2026-07-01T00:00:00.000Z \
  --source-url https://www.huduser.gov/portal/datasets/usps_crosswalk.html
```

The build records the input SHA-256 and source row count, scopes county relationships to the 50 states and DC, and records the number of rows outside that release scope. It rejects invalid ZIP/FIPS identifiers, duplicate ZIP-county pairs, allocation ratios outside zero to one, invalid ratio totals, orphan counties, and subnational coverage. For ZIPs with no residential addresses, the published total-address ratio is the deterministic fallback.

## Approved Census ZCTA proxy

The committed proxy is generated from `sozorock-health` `county-resolution-index.v2.json`, which aggregates 2025 Census Geographic Reference File block land area across current ZCTAs and counties. Version 2 is used because it has the current 2025 ZCTA inventory and a checksum manifest for all 51 state/DC source files. The import preserves all 46,641 overlaps, including zero-rounded sliver relationships, the 51 upstream URLs and checksums, upstream method and caveat, generation time, vintage, and input checksum.

```bash
node scripts/build-national-geography.js \
  --census-zcta-index /workspace/sozorock-health/packages/evidence-core/data/national/county-resolution-index.v2.json \
  --effective-date 2025-01-01 \
  --generated-at 2026-07-26T15:51:10.955Z
```

Imported source SHA-256: `8c8e8328c0152afb0edf9f4ef61f41fdc85d957664887621b0152a8a1d04ffc1`. Generated proxy SHA-256: `0327eedff1e2bdc4b04a490b9a70d90e5af21c16249295ab1161f68e9837f086`.

The required runtime caveat is: “A postal ZIP Code is not a Census ZCTA. ZIP input uses the same-numbered Census ZCTA only as a county-selection proxy; it is not exact USPS ZIP geography.”

## Loading and activation

- Development and tests may use the clearly identified ZIP seed.
- `NODE_ENV=production` never uses a seed or silently recovers from missing, unreadable, malformed, or incomplete files.
- A complete HUD artifact is preferred when present. Otherwise, a complete governed Census ZCTA proxy is accepted. Invalid HUD data is not silently bypassed by the proxy.
- `loadCountyArtifact({ production: true })` and `loadZipArtifact({ production: true })` validate the complete files before returning data.
- The production readiness report includes `nationalGeography`; controlled activation requires the complete county file and one complete postal-selection method, and reports its active method and geography kind.
- The health endpoint reports count, version, effective date, readiness, and source checksum for operational inspection.
- Unknown ZIP/FIPS returns no result. Multi-county ZIPs retain all relationships. Missing evidence remains unavailable rather than becoming zero or a neighboring county value.

Run `npm test` and `npm run lint` after every refresh. Review checksum and count changes before committing a new governed release.
