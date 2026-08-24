# CB-CAP Memory Governance

## Purpose

CB-CAP memory exists to preserve accountable institutional work without turning ordinary conversation, model output, collaboration notes, or evaluation feedback into organizational truth.

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

## Learning memory

Learning memory is implemented as a fourth, separate domain for structured performance evidence. It contains:

- immutable execution trajectory events;
- human, deterministic, or model evaluation labels;
- authorized human corrections;
- proposed regression, prompt, policy, routing, or code improvements by governed reference;
- immutable human review of those improvement candidates.

It answers: **What happened, how was it evaluated, what correction was identified, and what should humans consider changing in a future reviewed release?**

Learning memory is not institutional truth and is not a self-modification mechanism. Raw page content and chat transcripts are excluded. An improvement candidate must reference an existing evaluation or correction in the same tenant. PostgreSQL validates those references against the active tenant before insertion.

An evidence agent may propose a candidate from existing evaluation evidence. Only a human `foundation_reviewer` with owner or contributor access may approve or reject the candidate. Approval still records `automaticApplicationAllowed: false` and `applicationState: not_applied`.

There is no runtime method that applies an approved learning candidate to production. Prompt, policy, tool routing, model routing, code, and regression changes must be implemented, tested, reviewed, and released separately.

See `docs/LEARNING_MEMORY.md` for the detailed contract.

## Tenant isolation

Run, workspace, institutional, and learning memory use the same authenticated tenant authority as institutional CB-CAP.

PostgreSQL controls include:

- tenant ID on every record;
- forced row-level security;
- `app.tenant_id` policies;
- transaction-local tenant context;
- same-tenant foreign keys or database validation for governed references;
- application roles that must not own protected tables or hold `BYPASSRLS`.

Tenant identity is never accepted from a client-supplied memory payload.

## Data minimization

Workspace content is bounded in size. Institutional records carry evidence identifiers and rationale rather than uncontrolled transcript dumps. Learning trajectories store structured state hashes, source identifiers, reason codes, tool names, and model accounting only where a model actually participated.

Individual medical records, PHI, inferred individual clinical risk, credentials, secrets, raw external documents, and uncontrolled conversation transcripts do not belong in CB-CAP memory.

## Operating rule

**Run memory records what happened. Workspace memory records what the team is working on. Institutional memory records what authorized people reviewed and decided. Learning memory records evaluated evidence and reviewed candidates for future releases, but never changes production by itself.**
