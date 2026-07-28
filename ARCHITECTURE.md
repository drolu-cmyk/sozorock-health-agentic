# SozoRock Health Agentic Infrastructure — Architecture

## Positioning

SozoRock Health is non-clinical systems infrastructure.
It sits on top of existing health, public, digital, and workforce systems.
It does not diagnose, treat, or store individual medical records.
It produces place intelligence, access pathways, and planning evidence.

## Experience Separation

One underlying intelligence system. Five distinct experiences:

| Experience | Audience | Purpose |
|------------|----------|---------|
| **Resident Access** | Residents, caregivers | Natural language entry → clear next step |
| **Planner Workspace** | County staff, libraries, community partners | Hub matching, Access Day planning, local coordination |
| **CB-CAP Environment** | County planners, health departments | Full systems intelligence, scenarios, CHA/CHIP support |
| **Funder Evidence View** | Funders, foundations, government | Reach, equity metrics, intervention evidence |
| **Governance Console** | Internal operators | Audit, policy, data lineage, agent oversight |

Public-facing experiences never expose technical audit logs or internal agent state.

## Agent Hierarchy

```
Chief of Staff Agent
├─ Research Agent          (public datasets, citations, freshness)
├─ Geography Agent         (ZIP → FIPS → county resolution)
├─ Barrier Agent           (transparent scoring, deterministic rules)
├─ CHA/CHIP Agent          (planning support across counties)
├─ Hub Matching Agent      (Library / Community / Home fit)
├─ Report Agent            (partnership, intervention, funding briefs)
└─ Compliance Agent        (policy gate, data minimization, audit)
```

The Chief of Staff receives a task, selects and sequences sub-agents, enforces policy, and returns structured output only.

## Core Contracts

### Place Intelligence Package
- `location` (ZIP / FIPS / county)
- `brief` (status, context, gaps)
- `map` (geography + evidence layers)
- `action` (recommended next steps)
- `evidence` (sources with release dates and citations)
- `hubs` (ranked format fit)
- `meta.sourceFreshness` (required)
- `meta.nonClinical` (required true)
- `meta.sourceTraceable` (required true)

### County / FIPS Contract
Every county record must carry:
- `fips`
- `name`
- `state`
- `geography`
- `barriers` (scored, transparent methodology)
- `sources[]` (citation + release date)
- `freshness` (ISO date of underlying data)

## CB-CAP Role

CB-CAP is a distinct planning engine.
Explore / Place Intelligence is the accessible front door.
CB-CAP provides deeper county systems intelligence, scenario modeling, and CHA/CHIP workflow support.
They share contracts but serve different users and depths.

## Security & Compliance Principles

- No individual medical records
- Data minimization by default
- Deterministic policy rules (not probabilistic)
- Every agent action produces a server-side audit event
- Source freshness is mandatory
- Portable API contracts for external agents
