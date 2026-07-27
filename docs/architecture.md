# Architecture

## Goals

Provide a portable, agent-ready infrastructure that can serve place intelligence and access coordination for every U.S. county while remaining strictly non-clinical and source-traceable.

## Layers

### 1. Frontend (Explore + Voice)

Static assets that can be hosted on any object store or CDN.

- Place search and result rendering (Brief / Map / Action / Visuals)
- Voice Access interface (natural turn-taking, clarification loops)
- Hub format recommendations
- Health Access Day signals

### 2. Agent Layer

Orchestration modules that accept structured requests and return machine-readable plans.

- Place resolution
- Barrier scoring against public benchmarks
- Hub matching logic
- Action path generation
- Routing decisions that surface the appropriate next step

Agents operate on public evidence and local configuration only. They do not create clinical records or make medical judgments.

### 3. Data Contracts

Stable interfaces for county-level evidence.

- Geography identifiers (FIPS, GEOID, ZIP crosswalks)
- Public health estimates (CDC PLACES style fields)
- Barrier indicators
- Planning attention scores
- Source metadata (coverage, freshness, citation)

### 4. Integration Points

- CB-CAP county planning engine (deeper scenarios, CHA/CHIP shortlists)
- External agent consumers via simple HTTP or message contracts
- Optional real-time pricing or availability lookups (public sources only)

## Portability

All components are designed to run in isolation or together:

- Frontend can be deployed independently
- Agent stubs can be lifted into Lambda, ECS, or any Node runtime
- Data adapters are configuration-driven so source endpoints can change without code changes

## Non-Goals

- Clinical decision support
- Storage of individual medical records
- Replacement of existing provider platforms or county governance processes
