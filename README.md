# SozoRock Health — Place Intelligence

**SozoRock helps county teams turn fragmented public data into a shared, source-traceable access plan.**  
Enter a county, compare barriers, test delivery scenarios, and hand the live plan to partners and funders.

## 60–90 second workflow

1. Enter or speak a ZIP or county.
2. The system runs the Chief of Staff agent pipeline.
3. Sources and release dates appear beside each signal.
4. Scenarios show modeled reach and barrier-reduction estimates with formulas.
5. A session link can be shared so a second browser loads the same plan.
6. Every completed or blocked run is recorded in the server audit log.
7. The funder snapshot summarizes reach, hub mix, and barrier pressure.

## What works today

| Capability | Status |
|------------|--------|
| Runnable Express API (`/api/place`, `/api/cbcap`, sessions) | Working |
| Chief of Staff + sub-agents (geography, research, barrier, hub, report, compliance) | Working |
| Browser speech recognition → server pipeline | Working |
| Server-backed session IDs (shareable across browsers) | Working |
| Compliance after report generation + clinical-language scan | Working |
| Source citations + freshness required | Working |
| Scenarios labeled as modeled estimates with formula/uncertainty | Working |
| Valid OpenAPI 3.1 (`docs/openapi.yaml`) | Working |
| Unit tests + GitHub Actions CI | Working |
| Frontend renders the live server package | Working |

## Current data scope (exact)

- **Geography resolution:** Demonstration ZIP set for Schoharie County (FIPS 36095) and Delaware County (FIPS 36025), New York. County-name resolution for those two counties. Unknown locations return a clear error — no invented geography.
- **Indicators:** Modeled demonstration values with published methodology. Not live CDC PLACES or ACS field extractionsions.
- **Sessions:** In-memory on the server process. Lost on restart. No authentication yet.
- **Map:** Marker at approximate county center. Heat points only when CB-CAP returns them for the demonstration counties.

National architecture (FIPS contracts, agent pipeline, OpenAPI, policy gate) is in place so live adapters and a full ZIP–county crosswalk can be added without rewriting the product surface.

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

```bash
npm test
```

## API

See `docs/openapi.yaml` for the machine-readable contract.

| Endpoint | Method | Purpose |
|----------|--------|--------|
| `/api/health` | GET | Health |
| `/api/place` | POST | Place intelligence (`{ location, purpose }`) |
| `/api/cbcap` | POST | CB-CAP county plan |
| `/api/sessions` | POST | Create shared session |
| `/api/sessions/:id` | GET/PUT | Read / update session |
| `/api/audit` | GET | Internal audit events |

`purpose`: `resident` | `planner` | `funder` | `cbcap`

## Agent hierarchy

```
Chief of Staff
├── Geography Agent
├── Research Agent
├── Barrier Agent          (transparent weights)
├── Hub Matching Agent
├── Report Agent
└── Compliance Agent       (runs after report)
```

## Design rules enforced in code

- Non-clinical only
- Source freshness required
- Citations required on every source
- Deterministic barrier scoring
- Modeled scenarios must declare formula and uncertainty
- Unknown geography fails closed

## Next implementation priorities (in order)

1. Full national ZIP ↔ FIPS crosswalk + county reference table
2. Live, versioned adapters (CDC PLACES, ACS) with field-level lineage
3. Durable sessions (Postgres) + authentication + roles
4. Live multiplayer (SSE/WebSocket) and participant identity
5. Separated Resident / Planner / CB-CAP / Funder / Admin experiences
6. Production deployment pipeline and security hardening

## License

MIT

---

SozoRock Health · Non-clinical systems infrastructure · Source-traceable · Auditable
