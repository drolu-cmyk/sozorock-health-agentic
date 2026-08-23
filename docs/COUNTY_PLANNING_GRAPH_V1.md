# County Planning Graph v1

Status: implementation draft pending executable CI verification

## Purpose

The County Planning Graph is CB-CAP's first durable execution graph. It replaces prompt-led sequential orchestration with explicit state transitions, bounded parallel work, deterministic gates, checkpoints and resumable human review.

It is intentionally model-free in v1. A complete v1 run should consume zero model tokens and incur zero model cost.

## Why this comes before specialist agents

CHA/CHIP researchers, hospital CHNA researchers, barrier analysts, visualization agents, forecasting agents and funding agents need a common execution contract. Without that contract, every specialist would invent its own memory, retries, security rules, cost tracking and handoff format.

The County Planning Graph establishes those rules once.

## Runtime

- Python
- LangGraph `StateGraph`
- `CountyRunState` as the canonical planning-domain payload
- `CountyGraphState` as the operational graph envelope
- Pydantic validation at domain boundaries
- explicit `thread_id` per run for checkpoint identity
- in-memory checkpoint saver only for tests/local development
- durable Postgres checkpoint saver required for production

The production checkpointer must be deployed on the approved SozoRock AWS architecture. The graph code must not depend on a managed LangGraph deployment service.

## State layers

### CountyRunState

Authoritative planning state:

- county identity
- verified evidence
- barriers and patterns
- plans and priorities
- organizations
- funding opportunities and fit
- forecasts and scenarios
- conflicts
- human decisions
- agent run metadata
- publication artifacts
- deterministic workflow flags

### CountyGraphState

Operational graph state:

- serialized `CountyRunState`
- run budget
- branch results
- graph audit events
- review outcome

Operational records use stable IDs and reducer-based de-duplication so replay does not duplicate a branch result or audit event.

## Graph

```text
START
  |
  v
resolve_geography
  |
  v
establish_run_state
  |
  +-- cancelled ----------------------------> cancelled -> END
  |
  +--> public_evidence ---------+
  +--> planning_documents ------+
  +--> workforce_designations --+--> validate_join
  +--> barrier_evidence --------+
                                   |
                                   v
                               policy_gate
                                   |
                   +---------------+---------------+
                   |               |               |
                blocked        mark_review       finalize
                   |               |               |
                   v               v               v
                  END         human_review         END
                                   |
                              approve/reject
                                   |
                             +-----+------+
                             |            |
                         finalize       blocked
                             |            |
                            END          END
```

## Parallel fan-out

The first fan-out has four deterministic branches:

1. public evidence
2. planning documents
3. workforce/designations
4. barrier evidence

These are placeholders for future typed subgraphs, not permanent single-function implementations.

Each branch returns a `BranchResult`. Parallel branches do not directly overwrite the shared `CountyRunState`; their outputs are reduced and joined first. This prevents concurrent state writes from silently overwriting one another.

## Join behavior

`validate_join` requires every expected branch to be present and complete.

It then sets state flags such as:

- `required_sources_complete`
- `evidence_validated`
- `source_conflict`
- `blocking_conflict`
- `needs_human_review`

A conflict becomes an explicit `Conflict` object rather than an unstructured warning string.

## Flags, not prompts

The graph routes using typed state.

A prompt or retrieved document cannot set:

- `safe_to_publish`
- `publication_approved`
- `policy_passed`
- `budget_exceeded`
- `cancel_requested`
- review completion

The `CountyRunState` validator rejects `safe_to_publish=true` unless deterministic publication preconditions are already satisfied.

## Human review

Blocking conflicts route to a persisted interrupt.

The graph exposes only the review context needed by the reviewer:

- run ID
- county
- blocking conflict IDs
- allowed decisions

Resume requires a structured decision, reviewer identity and reason.

An approval resolves the blocking state and records a `ReviewDecision`. A rejection, request for revision or deferral does not silently continue to publication.

## Cost controls

`RunBudget` is provider-independent and currently tracks:

- maximum model tokens
- maximum model cost
- maximum external calls
- consumed model tokens
- consumed model cost
- consumed external calls

The first graph uses no model nodes. Its expected model token and cost usage are both zero.

When model-backed specialists are introduced, they must report usage into this budget rather than managing spend independently.

## Untrusted content

`CountyGraphContext.untrusted_source_text` exists only as an adversarial test surface in v1. Branches deliberately ignore it as control input.

Future research subgraphs may parse untrusted source content into typed evidence, but raw source text must never become workflow instructions.

## Retry policy

Read/research branches use a bounded retry policy. Side-effecting writes should not depend only on retry behavior; they require stable idempotency keys and storage-level uniqueness guarantees.

## Persistence

The default `InMemorySaver` exists only so the graph can be exercised without infrastructure.

Production requirements:

- PostgreSQL-backed LangGraph checkpointer
- durable county/run identity
- tenant-isolated access
- encryption and AWS-managed secrets
- backup and recovery
- checkpoint retention policy
- audit correlation IDs

Long-lived institutional memory is separate from checkpoint state. Checkpoints answer "where is this run?"; the CB-CAP evidence/organization stores answer "what has this county and organization learned over time?"

## Current acceptance suite

The committed graph tests cover:

- deterministic completion
- four-branch fan-out/join
- zero model usage
- cancellation before fan-out
- budget kill switch
- untrusted-instruction resistance
- source-conflict interrupt and structured resume
- human approval and conflict resolution
- idempotent branch-result reduction
- reuse of the same graph across Albany, Schenectady, Montgomery, Chester and Bexar counties

The suite is committed but must not be called verified until the private repository's GitHub Actions execution issue is resolved or a runner with the LangGraph dependency successfully executes it.

## Evolution into subgraphs

The four v1 functions become subgraphs in later phases.

### Public Evidence Subgraph

Evidence Gateway retrieval, release validation, freshness, source hashes and geography matching.

### Planning Document Subgraph

CHA, CHIP, CHNA, implementation strategies, local plans, document discovery, extraction and citation verification.

### Workforce and Designation Subgraph

HRSA designations, workforce supply, contextual capacity and related evidence.

### Barrier Evidence Subgraph

Barrier ontology mapping, individual observations, concentration, interactions, trends and evidence quality.

Additional subgraphs later attach after the validated evidence join:

- Visualization Intelligence
- Forecast and Scenario
- Funding Intelligence
- Stakeholder/Organization Intelligence
- Brief/Artifact generation

## Non-goals for v1

- no LLM supervisor
- no autonomous web research
- no self-modifying agents
- no production deployment
- no national fan-out
- no paid UI redesign
- no opaque composite barrier score

## Promotion gate

County Planning Graph v1 should not be promoted beyond draft until:

1. the public Evidence Gateway PR is green
2. the private runner executes the graph suite
3. checkpoint/resume behavior is observed in a real test run
4. a Postgres checkpointer integration test is designed for the AWS target environment
5. security adversarial cases remain green
