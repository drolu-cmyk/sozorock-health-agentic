# Repository Inventory

Status: initial reconnaissance for CB-CAP productization

## 1. `drolu-cmyk/sozorock-health`

Role: canonical public SozoRock Health and Explore repository.

Relevant assets:

- `apps/public-site/app/explore` — current open Explore experience
- `apps/platform` — current CB-CAP demonstration UI and planning surface
- `packages/evidence-core` — national evidence ingestion, geography, ACS, HRSA, AHRF, AHRQ, local-plan coverage, migrations, review tooling and evaluation scripts
- `packages/domain` — shared domain types and logic
- infrastructure and security documentation

Decision:

- keep Explore here
- keep public evidence source of truth here until a dedicated evidence service is intentionally separated
- treat `apps/platform` as migration input for CB-CAP, not the final home for proprietary product logic

## 2. `drolu-cmyk/sozorock-health-agentic`

Role: canonical private CB-CAP product repository going forward.

Relevant assets:

- existing agent architecture documents
- existing Express runtime
- existing `PlaceAgent`, `HubMatcher` and linear orchestrator prototypes
- API, server, packages, tests and frontend scaffolding

Decision:

- evolve this repository into the licensed CB-CAP product
- replace the current linear orchestration model with durable typed graph execution
- keep proprietary organization memory, planning graph state, funding intelligence, autonomous trajectories, evaluations and governance controls here

## 3. `drolu-cmyk/agentic-ai-sozorock-health`

Role: historical/reference repository containing prior web implementation, planning facts, product definitions, design decisions, issue documents and agent/development rules.

Relevant assets identified:

- `docs/facts/cb-cap-definition.md`
- geospatial and maps strategy documents
- geospatial planning-output facts
- prior CB-CAP/maps issue specifications
- security and workflow rules
- prior AWS Amplify and web application material

Decision:

- do not delete or archive yet
- inventory unique decisions and reusable assets
- migrate only material still consistent with the current product direction
- do not allow it to become a second canonical CB-CAP implementation

## 4. `drolu-cmyk/health-sozorock`

Role: earlier SozoRock Health resident-access and county-access-review application and documentation source.

Relevant assets identified:

- resident access application
- county access review concepts
- non-clinical trust boundary
- AWS architecture and cost-gate documents
- automation operating model

Decision:

- not the canonical home for Explore or CB-CAP
- retain as a reference until any unique health-access or infrastructure decisions are reconciled with `sozorock-health`

## Canonical ownership after this decision

| Concern | Canonical location |
|---|---|
| Public SozoRock Health | `sozorock-health` |
| Explore | `sozorock-health/apps/public-site/app/explore` |
| Public Evidence Core | `sozorock-health/packages/evidence-core` |
| Current CB-CAP demo to migrate | `sozorock-health/apps/platform` |
| Licensed CB-CAP product | `sozorock-health-agentic` |
| Historical CB-CAP/product decisions | `agentic-ai-sozorock-health` |
| Earlier resident/county access implementation | `health-sozorock` |

## Migration rule

Nothing is deleted merely because it is no longer canonical. Before retirement, a repository must be checked for unique product decisions, security controls, data contracts, deployment knowledge, tests and intellectual-property-relevant material.

## Immediate migration candidates

From `sozorock-health/apps/platform`:

- geography search and profile interaction patterns
- national county map behavior
- metric definitions and semantics
- barrier and prevention views
- CHA/CHIP workspace concepts
- scenario planner concepts
- evidence workspace concepts
- report/export behavior
- accessibility and UI tests

From `sozorock-health/packages/evidence-core`:

- geography and source contracts
- national evidence outputs
- HRSA/AHRF/AHRQ/ACS context
- local-plan coverage
- five-place evaluation methodology
- provenance and freshness behavior

From `agentic-ai-sozorock-health`:

- CB-CAP definition and non-clinical boundaries
- geospatial planning requirements
- useful prior issue decisions
- security/workflow guardrails that remain applicable

## Material that should not be copied forward blindly

- old product positioning that conflicts with the new professional planning product
- generic agent hierarchies without typed graph state
- duplicated public datasets
- browser-local state that should become persistent tenant/workspace state
- unrestricted free-text agent handoffs
- deployment assumptions that have not been revalidated
- public-facing implementation details that belong only in internal architecture documentation
