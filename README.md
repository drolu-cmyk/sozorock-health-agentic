# SozoRock Health — Place Intelligence

**SozoRock helps county teams turn fragmented public data into a shared, source-traceable access plan.**  
Enter a county, compare barriers, test delivery scenarios, and hand the live plan to partners and funders.

Version **0.5.0** starts nationwide foundation work: national geography contracts, ZIP crosswalk with multi-county handling, lineage-backed adapters, and durable session storage.

## What county teams can do today

1. Resolve a ZIP or county name (multi-state seed + full-file loader).
2. Run the agent pipeline against source-backed indicators when snapshots exist.
3. See citations and release dates on each available signal.
4. Share a plan link that **survives server restart** (file-backed sessions).
5. Export a planning brief for partner / funder handoff (modeled scenarios labeled as estimates).

## Nationwide foundation (started)

| Component | Status |
|-----------|--------|
| National county/FIPS reference + multi-state seed | Live; full table via `national-counties.full.json` |
| ZIP–County crosswalk + multi-county ZIPs | Live; full HUD file via `hud-zip-county.json` |
| County/state name resolution | Live |
| Source lineage contract on every signal | Live |
| CDC PLACES adapter | Live (snapshot mode; full release via file) |
| ACS 5-year adapter | Live (snapshot mode; full extract via file) |
| Fail-closed when no source data | Live |
| Durable sessions (file-backed) | Live |
| Census boundary map layers | Not yet |
| Live API fetch to CDC/Census | Not yet (file snapshots first) |
| Auth / roles / live multiplayer presence | Not yet |
| Multi-county funder aggregation | Not yet |
| Production cloud deploy | Not yet |

See `docs/NATIONAL_DATA_INGEST.md` for how to load full national files.

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
npm test
```

Health check reports geography and crosswalk coverage: `GET /api/health`

## Agent hierarchy

```
Chief of Staff
├── Geography Agent      (national table + ZIP crosswalk)
├── Research Agent       (PLACES + ACS adapters + lineage)
├── Barrier Agent        (sparse-safe scoring)
├── Hub Matching Agent
├── Report Agent
└── Compliance Agent
```

## Design rules

- Non-clinical only
- No barrier score without source lineage
- Unknown geography fails closed
- Modeled scenarios declare formula and uncertainty
- Sessions persist on disk under `data/sessions/`

## License

MIT
