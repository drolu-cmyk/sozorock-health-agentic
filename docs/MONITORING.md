# Governed Monitoring Intelligence

CB-CAP monitoring detects changes in governed planning evidence and institutional workflow conditions without turning a change detector into a decision-maker.

## Contract

Monitoring evaluations use `cbcap.monitoring.v1`.

Supported monitor kinds are:

- Evidence Gateway release changes;
- reviewed local planning-document changes;
- reviewed funding-opportunity changes and deadlines;
- institutional workflow commitments;
- evidence expiry or validity changes.

The evaluator returns one of four states:

- `no_change`;
- `change_detected`;
- `attention_required`;
- `blocked`.

## Authority model

The client may provide only:

- a reviewed monitor ID;
- an optional as-of date.

The client cannot provide the monitor definition, current source snapshot, source fingerprint, source status, deadline, or validity period.

The authenticated tenant runtime resolves the reviewed monitor definition and current governed snapshot through server-owned providers. This prevents a client from manufacturing a change, suppressing a change, or redefining the monitored condition.

## Monitoring definitions

A reviewed monitor definition binds:

- monitor ID;
- monitor kind;
- governed subject ID;
- optional geography;
- reviewer identity and review time;
- baseline fingerprint, state, deadline, or validity period as applicable.

Definitions must be `verified` before they can produce a usable change finding.

## Governed snapshots

Current snapshots must identify themselves as `sourceAuthority: governed` and be verified. They carry only structured state needed for comparison:

- current fingerprint;
- observed time;
- state;
- deadline;
- valid-through date;
- governed source entity IDs.

Raw source content is not copied into the monitoring finding store.

## Change semantics

Evidence releases and planning documents use stable SHA256 fingerprints. A changed fingerprint produces `change_detected` but does not decide whether the new evidence should be accepted.

Funding monitoring may surface changed criteria, changed deadlines, passed deadlines, closure, cancellation, or withdrawal. It never determines final eligibility, award likelihood, or allocation.

Workflow commitments may surface a changed state, changed deadline, or overdue open commitment. Completion is recorded as a state change, not automatically interpreted as successful impact.

Evidence-expiry monitoring surfaces an expired or changed validity condition. Missing governed validity metadata blocks the evaluation rather than inventing an expiry rule.

## Finding persistence and deduplication

Only `change_detected`, `attention_required`, and `blocked` states are persisted. `no_change` is evaluated but not stored as a finding.

Every persisted finding has a deterministic SHA256 key derived from the stable monitored condition, not the evaluation date. Re-evaluating the same unchanged overdue or expired condition on a later date therefore returns the same key instead of generating daily duplicate findings.

PostgreSQL enforces:

- tenant scope;
- forced row-level security;
- a unique finding key per tenant;
- append-only history;
- actionable/blocked status constraints.

## Human decision boundary

Monitoring may recommend that a finding be surfaced to an authorized user. It does not itself:

- send an external notification;
- change a workflow task;
- approve or reject a plan;
- adopt a changed document;
- alter a funding decision;
- promote a finding into institutional memory;
- modify production behavior.

Actionable and blocked findings require human review. The output always states:

- `automaticActionTaken: false`;
- `automaticInstitutionalMemoryPromotion: false`.

## Scheduling boundary

This repository provides the governed evaluation and finding-persistence capability. It does not claim that a background scheduler is deployed merely because monitoring code exists.

A production scheduler, event source, or managed automation may invoke the authenticated monitoring capability later. That scheduler must use the same tenant identity, provider, persistence, observability, and failure controls as an interactive evaluation.

**Agents can watch. People decide what changes.**
