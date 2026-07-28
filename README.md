# SozoRock Health Agentic Infrastructure

Non-clinical systems infrastructure for place intelligence and access coordination.

**Current status:** Working prototype with a real runnable server, agent orchestration, policy enforcement, and demonstration data for selected New York counties. Not yet a production nationwide service.

## Honest scope

| Claim | Reality |
|-------|--------|
| Runnable Place Intelligence API | Yes — `POST /api/place` via Express |
| Real speech input | Yes — browser Web Speech API when available |
| Shared sessions across browsers | Yes — server-side in-memory sessions |
| Nationwide ZIP coverage | No — demonstration ZIPs for Schoharie & Delaware Counties, NY |
| Live CDC / Census queries | No — modeled demonstration indicators with citations |
| Durable multi-user auth | No — open demo sessions, no authentication yet |
| Production deployment | Not yet |

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

| Endpoint | Method | Purpose |
|----------|--------|--------|
| `/api/health` | GET | Health check |
| `/api/place` | POST | Place intelligence (`{ location, purpose }`) |
| `/api/cbcap` | POST | CB-CAP county plan (`{ location }`) |
| `/api/sessions` | POST | Create shared session |
| `/api/sessions/:id` | GET / PUT | Read / update session |
| `/api/audit` | GET | Internal audit log |

`purpose` values: `resident` | `planner` | `funder` | `cbcap`

## Agent hierarchy

```
Chief of Staff
├── Geography Agent
├── Research Agent          (modeled demonstration data)
├── Barrier Agent           (transparent deterministic scoring)
├── Hub Matching Agent
├── Report Agent
└── Compliance Agent        (text inspection + source linkage required)
```

Compliance runs **after** report generation so report content is evaluated.

## Data honesty

- Barrier scores are **modeled estimates** with published weights.
- Scenario projections are **modeled estimates** and carry formula, assumptions, and uncertainty notes.
- Source freshness and citations are required fields.
- Geography resolution currently covers selected demonstration ZIPs only. Unknown ZIPs return a clear failure.

## Experiences (architecture target)

One intelligence system, five distinct experiences:

1. Resident Access
2. Planner Workspace
3. CB-CAP Environment
4. Funder Evidence View
5. Governance Console (audit only)

The current frontend is still a combined demo. Separation of UIs is the next product priority.

## License

MIT

---

SozoRock Health · Non-clinical · Source-traceable · Auditable
