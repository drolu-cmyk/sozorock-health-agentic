# Phase 1: Canonical CB-CAP State and Shared Evidence Contracts

Status: implementation baseline

## Decision

The public `sozorock-health` Evidence Core remains authoritative for public geography, source lineage, measure semantics, observations and reviewed public planning evidence.

The private `sozorock-health-agentic` repository owns CB-CAP's graph state, tenant/private state, planning memory, funding fit, forecasts, agent trajectories and governance state.

CB-CAP consumes public evidence through a versioned boundary rather than importing public-repository implementation code.

## Python package

`python/cbcap_core`

The package is intentionally independent of any model SDK or graph runtime. State contracts must remain stable even if CB-CAP changes model providers or orchestration libraries.

Current dependency:

- Pydantic 2.x

## Public Evidence Core compatibility

The initial mapping from `sozorock-health/packages/evidence-core/src/contracts.ts` is:

| Public Evidence Core | CB-CAP gateway model | Role |
|---|---|---|
| `Geography` | `GeographyRef` | stable place identity |
| `GeographyRelationship` | `GeographyRelationshipRef` | geography relationship and overlap |
| `SourceVersion` | `SourceVersionRef` | source release, hash and freshness |
| `MeasureDefinition` | `MetricSemantics` | comparison and interpretation rules |
| `MetricObservation` | `Measure` | observed public value with lineage |
| `PlanningDocument` | `SourceDocument` + `PlanDocument` | document identity and planning role |
| `EvidenceClaim` | `EvidenceClaim` | structured source-grounded claim |
| `EvidenceCitation` | `CitationLocator` | claim locator/provenance |

The gateway contract version is `sozorock.evidence-gateway.v1`.

## CB-CAP-only state

The public Evidence Core must not become the persistence home for the following proprietary objects:

- `BarrierObservation`
- `BarrierPattern`
- `PlanPriority` when it contains CB-CAP interpretation or tenant decisions
- `Organization` private context
- `FundingFit`
- `ScenarioAssumption`
- `ForecastResult`
- `Conflict` resolution state
- `ReviewDecision`
- `AgentRun`
- `PublicationArtifact`
- `CountyRunState`
- tenant IDs, permissions, assignments and collaboration state
- trajectory/evaluation datasets

Public facts may be referenced by stable IDs. They should not be copied into a separate uncontrolled source of truth.

## CountyRunState

`CountyRunState` is the first canonical graph state. It is designed to become the durable checkpoint payload for the County Planning Graph.

It contains:

- county identity
- workflow flags
- source documents
- evidence claims
- measures
- barrier observations and patterns
- plans and priorities
- organizations
- funding opportunities and fit
- scenario assumptions
- forecasts
- conflicts
- human review decisions
- agent-run metadata
- publication artifacts

Each graph node should read a typed subset and write a typed state delta. Raw prose between agents is not authoritative state.

## Workflow flags

Workflow transitions are controlled by explicit flags rather than instructions embedded in prompts.

Initial flags:

- `geography_verified`
- `required_sources_complete`
- `evidence_validated`
- `source_conflict`
- `blocking_conflict`
- `needs_human_review`
- `review_complete`
- `policy_passed`
- `budget_exceeded`
- `cancel_requested`
- `safe_to_publish`
- `publication_approved`

The model validator fails closed if `safe_to_publish` is asserted before its deterministic preconditions are satisfied.

## Metric semantics

`MetricSemantics` extends the public measure-definition concept with explicit machine-readable controls for future visualization and forecasting:

- `trendable`
- `forecastable`
- `aggregatable`
- allowed geography kinds
- allowed visualization families

These fields prevent a charting or forecasting agent from treating every public number as comparable through time or across geographies.

The values must ultimately be curated and versioned from methodology, not guessed by a model at runtime.

## Public/private gateway boundary

`PublicEvidencePackage` uses strict validation and rejects unknown fields.

It contains only:

- contract version
- public release identity
- generation timestamp
- geographies
- geography relationships
- metric semantics
- public measures
- source versions

It deliberately has no fields for:

- `tenant_id`
- funding fit
- private planning notes
- organization-private data
- approvals
- agent trajectories
- model prompts
- internal policy state

This makes accidental private-state leakage a schema error rather than a copywriting convention.

## Initial tests

The package currently tests:

1. County graph state rejects non-county geography.
2. `safe_to_publish` cannot be set before deterministic preconditions pass.
3. Public gateway payloads reject tenant/private fields.
4. A public fact retains its value and source provenance through the gateway model.
5. Unknown contract fields fail closed.
6. The initial five-county evaluation set can be represented by `CountyRunState`.

The test suite has been run locally against the package implementation and passes.

## CI

The repository CI now has a separate `cbcap-contract-tests` job using Python 3.12. Contract validation therefore becomes a pull-request gate alongside the existing Node tests.

## Next implementation

Phase 1 is not complete until the public Evidence Core can emit or serve a package conforming to `sozorock.evidence-gateway.v1` and cross-repository compatibility tests compare the same fact and provenance on both sides.

The next work should therefore occur in two coordinated branches:

1. public `sozorock-health`: add a versioned Evidence Gateway serializer/exporter backed by the existing Evidence Core
2. private `sozorock-health-agentic`: add a gateway client/fixture validator that consumes that output

Only after that contract is proven should the County Planning Graph runtime be introduced.
