# SozoRock Health — Place Intelligence

**SozoRock helps county teams turn fragmented public data into a shared, source-traceable access plan.**  
Enter a county, compare barriers, test delivery scenarios, and hand the live plan to partners and funders.

## 60–90 second workflow (supported counties)

1. Enter or speak a ZIP or county (currently Schoharie or Delaware, NY).
2. The system runs the Chief of Staff agent pipeline (`POST /api/place` + `POST /api/cbcap`).
3. Sources and release dates appear in the Brief.
4. Scenarios show modeled reach and barrier-reduction estimates with formulas.
5. A session link stores both the place package and CB-CAP plan so a second browser can restore and render them.
6. Completed and blocked runs are recorded in the server audit log.
7. The funder snapshot summarizes reach, hub mix, and barrier pressure for the selected place.

## What works today

| Capability | Status |
|------------|--------|
| Runnable Express API | Working |
| Chief of Staff + sub-agents | Working |
| Browser speech recognition → server pipeline | Working |
| Frontend renders the live server package | Working (syntax/XSS fixed) |
| Correct county map centers for demo counties | Working |
| Heat points for demo counties | Working |
| Session stores place + CB-CAP and restores on open | Working |
| Compliance after report + clinical-language scan | Working |
| Source citations + freshness required | Working |
| Scenarios labeled as modeled estimates | Working |
| OpenAPI 3.1 document | Present (`docs/openapi.yaml`) |
| Unit tests + CI | Working |

## Current data scope (exact)

- **Geography:** Demonstration ZIP set for Schoharie County (FIPS 36095) and Delaware County (FIPS 36025), New York only. Unknown locations return a clear error — no invented geography or scores.
- **Indicators:** Modeled demonstration values with published methodology. Not live CDC PLACES or ACS field extractions.
- **Sessions:** In-memory on the server process. Lost on restart. No authentication.
- **Audit route:** `/api/audit` is currently publicly accessible. Production requires auth and roles.
- **Funder view:** Single-place snapshot, not multi-county aggregation.

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

See `docs/openapi.yaml`.

| Endpoint | Method | Purpose |
|----------|--------|--------|
| `/api/health` | GET | Health |
| `/api/place` | POST | Place intelligence |
| `/api/cbcap` | POST | CB-CAP county plan |
| `/api/sessions` | POST | Create shared session |
| `/api/sessions/:id` | GET/PUT | Read / update session |
| `/api/audit` | GET | Audit events (unprotected) |

## Agent hierarchy

```
Chief of Staff
├─ Geography Agent
├─ Research Agent
├─ Barrier Agent
├─ Hub Matching Agent
├─ Report Agent
└─ Compliance Agent
```

## Next implementation priorities

1. Full national ZIP ↔ FIPS crosswalk + county reference table
2. Live, versioned adapters (CDC PLACES, ACS) with field-level lineage
3. Durable sessions (Postgres) + authentication + roles
4. Live multiplayer (SSE/WebSocket)
5. Multi-county funder aggregation
6. Separated Resident / Planner / CB-CAP / Funder / Admin experiences
7. Production deployment and security hardening

## License

MIT
