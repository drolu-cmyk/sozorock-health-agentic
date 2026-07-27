# SozoRock Health Agentic Infrastructure

Shareable, purpose-built infrastructure for place intelligence and access coordination across every U.S. county.

## What it is

A small cloud for live place plans. Multiple humans and agents can collaborate on the same county plan, hand it off, and keep an auditable trail of every action. Strictly non-clinical. Source-traceable. Ready for S3, CloudFront, Lambda, or any Node runtime.

## Core capabilities

| Capability | Status |
|------------|--------|
| Voice Access → Place Agent → live visual results | Live |
| CB-CAP county planning signals | Adapter in place |
| Shared live session (multiplayer) | Live |
| Scenario comparison tables | Live |
| Heat-style intensity layer on map | Live |
| Audit log + policy enforcement | Live |
| OpenAPI-style contracts | Documented |
| Funder snapshot (reach, hub mix, barrier pressure) | Live |
| Portable static frontend + agent stubs | Ready |

## How the pieces work together

1. A resident speaks or types a request (Voice Access).
2. The request runs the Place Agent and pulls CB-CAP planning signals.
3. Policy gate checks non-clinical and source-traceable constraints.
4. Results render as Brief / Map / Action / Visuals + scenarios + funder snapshot.
5. A shared session is created or updated so other humans or agents can join the same plan.
6. Every step is written to an append-only audit log.

## Architecture

```
frontend/               Explore + Voice + Session + Audit (static, S3-ready)
  js/session.js         Shared live plan model
  js/cbcap-adapter.js   County planning signals
  js/audit.js           Policy enforcement + audit trail
  js/voice-access.js    Natural language → full pipeline
  js/place-intelligence.js  Rendering + scenarios + heat markers

src/agents/
  place-agent.js        Location → structured intelligence
  hub-matcher.js        Barrier scores → hub ranking
  orchestrator.js       Full pipeline + policy gate

api/example-handler.js  Ready for API Gateway / Lambda
docs/                   Architecture, AWS notes, OpenAPI contracts
```

## Quick start

```bash
cd frontend
npx serve .
# open http://localhost:3000
```

Or open `frontend/index.html` directly.

Click **Share live plan** to copy a session URL that others can open and collaborate on.

## Deployment (AWS)

See `docs/deployment-aws.md`.

Frontend → S3 + CloudFront  
Agents → Lambda or ECS  
No individual health records are stored or processed.

## Design constraints (enforced in code)

- Non-clinical only
- Source-traceable evidence required
- Minimal data collection
- Human judgment remains visible
- Every agent action is auditable

---

SozoRock Health · Non-clinical · Source-traceable · Auditable · Nationwide
