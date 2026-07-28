# SozoRock Health Agentic Infrastructure

Non-clinical systems infrastructure for place intelligence and access coordination across every U.S. county.

One underlying intelligence system. Distinct experiences for different users.

## Experiences

| Experience | Audience | Status |
|------------|----------|--------|
| Resident Access | Residents, caregivers | Foundation ready |
| Planner Workspace | County staff, libraries, partners | Foundation ready |
| CB-CAP Environment | County planners, health departments | Planning engine live |
| Funder Evidence View | Funders, foundations | Report agent live |
| Governance Console | Internal operators | Audit + policy live |

Public-facing experiences do not expose technical audit logs.

## Agent Hierarchy (live)

```
Chief of Staff
├─ Geography Agent          ZIP → FIPS resolution
├─ Research Agent           Public evidence + freshness + citations
├─ Barrier Agent            Transparent deterministic scoring
├─ Hub Matching Agent       Library / Community / Home fit
├─ Report Agent             Partnership, intervention, funding briefs
└─ Compliance Agent         Policy gate + data minimization
```

## What is now in place

- Real ZIP-to-county/FIPS resolution foundation
- Transparent barrier calculations with published methodology
- Source freshness as a required field
- Deterministic policy and eligibility rules
- Chief of Staff orchestrating structured sub-agents
- Server-side Place Intelligence API
- CB-CAP as a distinct planning engine (scenarios, hub mix, CHA/CHIP support)
- Portable contracts and OpenAPI-style documentation
- County/FIPS-based data contracts
- Brief / Map / Action / Evidence concept preserved

## Repository layout

```
ARCHITECTURE.md                 Platform principles and experience separation
packages/
  agents/                       Chief of Staff + sub-agents
  core/                         Barrier scoring, policy primitives
  data/                         ZIP→FIPS, county contracts
  cbcap/                        Distinct planning engine
server/
  place-intelligence-api.js     Server-side entry point
frontend/                       Legacy demo (to be split into experiences)
docs/                           Deployment and contracts
```

## Next priorities (in order)

1. Full public dataset adapters with release dates (CDC PLACES, Census)
2. Durable sessions with authentication and permissions
3. Separated frontend experiences (Resident / Planner / CB-CAP / Funder / Admin)
4. Automated tests for geography, scoring, citations, safety, and API contracts
5. Historical comparison (current vs prior release)

## Design constraints (enforced)

- Non-clinical only
- Source-traceable evidence required
- Source freshness required
- Minimal data collection
- Deterministic policy rules
- Human judgment remains visible

---

SozoRock Health · Non-clinical systems infrastructure · Nationwide
