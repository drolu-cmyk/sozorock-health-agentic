# Phase 3 County Planning Graph

Status: implementation baseline

## Purpose

This graph replaces the earlier single-file linear orchestrator with a bounded, checkpointed workflow whose transitions are controlled by typed state rather than prompt text.

The graph does not make clinical decisions. It operates on county and community planning evidence.

## Current topology

`START -> resolve geography -> establish run state -> parallel research branches -> validation join -> policy gate -> review or finalize -> END`

The first fan-out contains four bounded branches:

1. public evidence
2. planning documents
3. workforce and shortage designations
4. barrier evidence

The join does not proceed until all branch nodes have completed. A branch is not considered complete merely because code executed. It must return at least one typed evidence identifier from the canonical `CountyRunState`.

## Fail-closed rules

A county run cannot become `safe_to_publish` unless all of the following are true:

- geography is verified
- required evidence branches are complete
- evidence is validated
- no unresolved source conflict exists
- no blocking conflict exists
- no human review remains outstanding
- policy checks pass
- the run budget is not exceeded
- cancellation has not been requested

Missing evidence therefore ends in a blocked run rather than an empty but apparently successful result.

## Zero-token default

The current graph executes without model calls.

Graph construction, fan-out, joins, state transitions, validation, audit events, cancellation, budgeting and policy gates are ordinary code and consume zero model tokens.

Future specialist nodes may call models only when semantic reasoning is required. Every such node must report token and cost usage into run state so the budget gate remains deterministic.

## Untrusted content boundary

Raw text from websites, PDFs, documents or other external sources is not accepted as routing, authorization or publication state.

External content must be converted into typed evidence objects before it can influence a planning decision. An instruction contained inside an external document cannot change graph policy.

## Human review

Source conflicts can interrupt graph execution. The graph persists state through the configured checkpointer and resumes only with a structured review decision.

An approved review clears the specific blocking state and records a `ReviewDecision`. Rejection, revision requests and deferral do not produce a publishable run.

## Persistence

`InMemorySaver` is allowed only for tests and local development.

Production must inject a durable checkpointer. The target remains PostgreSQL-backed persistence so workflow state, county memory and audit history can be recovered after process or infrastructure failure.

## Current tests

The Phase 3 control tests cover:

- empty evidence fails closed
- a hydrated typed run can complete without model tokens
- a simulated source conflict interrupts for human review and can resume
- a cancelled run does not fan out to research branches

These tests are additive to the Phase 1 typed-contract and cross-repository Evidence Gateway tests.

## Next implementation step

Replace each evidence-presence branch with a bounded specialist subgraph or adapter while keeping the same branch contract:

`typed input -> bounded work -> typed evidence IDs -> branch result -> validation join`

The first production specialist to implement should be the public Evidence Gateway adapter, followed by the CHA/CHIP planning-document research subgraph.

No specialist is permitted to bypass the validation join, policy gate or review gate.
