# CB-CAP Memory Governance

## Purpose

CB-CAP memory exists to preserve accountable institutional work without turning ordinary conversation, model output, or collaboration notes into organizational truth.

The platform separates four memory domains because they carry different authority, retention, and review requirements.

## Run memory

Run memory is immutable execution evidence. It records graph steps, checkpoints, policy decisions, errors, evidence release identities, and human review continuation.

It answers: **What did the governed runtime do?**

Run memory is append-only and tenant scoped. It is not a document workspace and cannot be edited into a preferred narrative after execution.

## Workspace memory

Workspace memory is mutable collaboration state. It includes:

- drafts;
- comments;
- tasks;
- saved analytical views;
- review questions.

It answers: **What is the team working on now?**

Workspace items use optimistic versioning. A stale write is rejected rather than silently overwriting another user's update. Every create/update also creates an append-only workspace event.

Workspace memory is not institutional truth. A draft, comment, saved view, or agent suggestion cannot be promoted automatically.

## Institutional memory

Institutional memory contains reviewed reusable decisions and interpretations. Supported decision classes include:

- planning interpretation;
- funding evidence fit;
- partner requirement;
- scenario decision;
- evidence correction;
- publication decision;
- monitoring commitment.

It answers: **What has an authorized institution actually reviewed and decided, under what evidence and scope?**

Institutional memory is append-only. Review, rejection, and supersession create new immutable records rather than modifying history.

Every proposed memory record requires:

- tenant and geography scope;
- decision and subject type;
- outcome;
- at least one reason code;
- written rationale;
- at least one governed evidence entity ID;
- proposer identity;
- applicability and optional expiry.

A proposal is not returned as active institutional knowledge until an authorized human reviewer approves it.

## Evidence validation

Evidence is validated twice:

1. when institutional knowledge is proposed;
2. immediately before an authorized reviewer approves it.

If the evidence is unavailable, unverified, withdrawn, or otherwise fails the configured validator, promotion fails closed.

This protects institutional memory from carrying forward a conclusion after its evidence has changed.

## Review authority

Foundation reviewers and county planners with owner or contributor access may review or supersede institutional memory.

Community partners with owner or contributor access may propose institutional memory but cannot approve it.

Research/funder viewers may read reviewed active memory but cannot create or promote it.

Evidence-agent actors may read reviewed active memory for bounded reasoning but cannot propose, approve, reject, or supersede institutional knowledge.

## Supersession and expiry

Reviewed knowledge may expire explicitly or be superseded when newer reviewed evidence changes the institutional interpretation.

Supersession does not erase the prior record. A new immutable record points to the record it supersedes. Default reads exclude superseded and expired knowledge while privileged review/history queries may retrieve them.

The database prevents more than one review record for a proposal and more than one supersession record for reviewed memory.

## Tenant isolation

Workspace and institutional memory use the same authenticated tenant authority as the rest of institutional CB-CAP.

PostgreSQL controls include:

- tenant ID on every record;
- forced row-level security;
- `app.tenant_id` policies;
- transaction-local tenant context;
- application roles that must not own protected tables or hold `BYPASSRLS`.

Tenant identity is never accepted from a client-supplied memory payload.

## Data minimization

Workspace content is bounded in size and memory records carry evidence identifiers and rationale rather than uncontrolled transcript dumps.

Individual medical records and inferred individual clinical risk do not belong in CB-CAP memory.

## Learning memory

Learning memory is a separate future domain. It will hold evaluated corrections, golden cases, regression outcomes, and proposed improvements.

A user interaction, model output, approval, or institutional memory record does not automatically alter production prompts, policies, tools, code, or model routing. Promotion into learning memory requires explicit evaluation and governance.

## Operating rule

**Run memory records what happened. Workspace memory records what the team is working on. Institutional memory records what authorized people reviewed and decided. Learning memory records only evaluated evidence for governed improvement.**
