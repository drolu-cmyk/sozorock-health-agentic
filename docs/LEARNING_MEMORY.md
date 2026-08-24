# Learning and Evaluation Memory

CB-CAP learning memory is a fourth memory domain. It is separate from run memory, workspace memory, and institutional memory because evidence about how the system performed is not the same thing as institutional truth.

## Purpose

Learning memory records structured evidence about execution quality so future releases can be evaluated and improved. It does not learn by silently rewriting production behavior.

The domain contains five append-only record types:

1. **Trajectory events** describe a bounded stage, actor, version, source entities, outcome, reason codes, state hashes, tool names, and optional model accounting.
2. **Evaluation labels** attach human or evaluator judgments to an immutable trajectory event.
3. **Corrections** capture authorized human corrections without mutating the original event.
4. **Improvement candidates** connect evaluations or corrections to a proposed prompt, policy, tool-routing, model-routing, regression, or code change by reference.
5. **Candidate reviews** record an authorized decision on the proposed improvement.

## Data minimization

Trajectory records are structured. Raw external page content and chat transcripts do not belong in this memory domain. Candidate records store a summary, rationale and governed artifact reference, not executable patches or prompt bodies.

Model identity is recorded only when a model actually participated. Deterministic events cannot claim model provider, model name, token usage, or model cost.

## Tenant boundary

Every learning record has a non-null tenant ID. PostgreSQL tables use composite same-tenant foreign keys, transaction-local `app.tenant_id`, enabled and forced row-level security, and append-only triggers.

The production application role must not own these tables and must not have `BYPASSRLS`.

## Correction authority

A human correction requires the same human review authority used for governed plan review. An evidence agent cannot create a human correction.

## Improvement candidates

An improvement candidate must reference at least one existing evaluation or correction in the same tenant. It may be proposed by a validated human or evidence agent, but it remains only a candidate.

The stored target types are:

- prompt change;
- policy change;
- tool-routing change;
- model-routing change;
- regression case;
- code change.

These values describe what a future reviewed release might change. They are not executable instructions.

## Promotion boundary

Only a human `foundation_reviewer` with owner or contributor access can approve or reject a learning candidate.

Approval produces an immutable `approved_candidate` review with:

- `automaticApplicationAllowed: false`;
- `applicationState: not_applied`.

There is deliberately no method that applies an approved candidate to production. A reviewed engineering or governance release must implement and test any approved change separately through the repository and deployment process.

This prevents:

- autonomous prompt mutation;
- autonomous policy mutation;
- autonomous tool or model routing changes;
- autonomous code changes;
- evaluation results becoming institutional truth;
- model-generated feedback becoming a production rule without review.

## Relationship to institutional memory

Institutional memory answers: **what reviewed decision or operating knowledge does this tenant rely on?**

Learning memory answers: **what happened, how was it evaluated, what correction was identified, and what change should humans consider for a future release?**

One cannot automatically promote into the other.

**AI drafts. People decide. Releases change production.**
