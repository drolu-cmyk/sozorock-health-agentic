# SozoRock Health Agentic Runtime Architecture

## Status

This document is the source of truth for the agent execution boundary. The runtime is a governed control plane for CB-CAP and related SozoRock Health workflows. It is not a second public-data warehouse and must not become one.

## Product boundary

SozoRock Health remains non-clinical systems infrastructure. The runtime may organize public evidence, identify evidence-supported barriers, prepare planning drafts, test bounded assumptions, and coordinate review. It does not diagnose, triage, prescribe, infer individual medical risk, determine eligibility, allocate funding, or replace an official county decision, CHA, CHIP, or licensed provider.

The operating principle is:

**AI drafts. People decide.**

## Product separation

The products share governed evidence contracts but not product depth.

| Experience | Primary role |
| --- | --- |
| Explore / Place Intelligence | Public, open-access evidence exploration |
| CB-CAP | Institutional decision workspace for county, public-health, funder, and partner planning |
| Agentic runtime | Server-side execution, policy, memory, orchestration, review gates, and audit |
| Governance console | Internal policy, trace, incident, approval, and model/tool controls |

CB-CAP must not be reduced to an expanded Explore interface. Its value comes from governed workflows, evidence relationships, scenarios, institutional memory, funding intelligence, collaboration, review history, and monitoring.

## Evidence authority

`drolu-cmyk/sozorock-health` is the governed Evidence Core and Evidence Gateway authority.

The agentic runtime consumes versioned Evidence Gateway packages. It must validate:

- contract identity;
- release identity and SHA-256 release hash;
- exact geography identity;
- source versions;
- reviewed metric semantics;
- published measures;
- source coverage and missingness.

Production agents must not independently re-fetch CDC, Census, HRSA, or other source data when the governed Evidence Gateway is the approved source for that evidence. The legacy adapters in this repository are migration assets and test fixtures until they are retired or explicitly reassigned. They are not a competing production evidence authority.

A geography mismatch, unsupported contract, release-identity mismatch, missing required provenance, or unavailable governed evidence fails closed.

## Runtime stack

The execution model is:

`Agent role -> Graph -> Harness -> Memory -> Approved tools -> Governed evidence`

Models are replaceable. The durable product value is the graph, policy harness, evidence contracts, review state, memory, tools, evaluation history, and institutional workflow.

### Graph

A graph owns workflow state and explicit transitions. CB-CAP v1 begins with:

`resolve_place -> load_evidence -> synthesize_barriers -> organize_plan -> scenario? -> draft_brief -> await_review -> publish?`

`scenario` is conditional. `publish` is conditional. Neither can be reached merely because a model suggests it.

Subagents become bounded graph nodes or approved tools rather than unconstrained peers. Future nodes may include local-plan review, funding-opportunity matching, partner mapping, monitoring, evaluation, and portfolio comparison, but each must have a typed input/output contract and policy gate before production use.

### Harness

The harness is deterministic runtime policy. At minimum it enforces:

- node allowlists;
- step budgets;
- kill switches;
- exact evidence-contract validation;
- non-clinical boundaries;
- scenario-assumption requirements;
- explicit human approval before publication or consequential external action.

Prompt text is not a security or governance control.

### Memory

Memory is evidence-bearing state, not an unbounded transcript dump.

Four layers are planned:

1. **Run memory** records append-only graph events, node transitions, policy decisions, errors, and release identities.
2. **Workspace memory** records user-approved planning state, comments, assumptions, drafts, review questions, and decisions for an institutional workspace.
3. **Institutional memory** stores reviewed reusable facts such as approved local definitions, partner roles, planning conventions, prior approved decisions, and monitoring commitments.
4. **Learning memory** stores evaluated patterns only after review. A model output or user interaction does not automatically become institutional truth.

The current in-memory implementation establishes the event contract only. Production persistence must use an authenticated database with tenant boundaries, authorization, retention rules, and immutable audit semantics.

## Barrier intelligence

A barrier is not a single transportation score. CB-CAP may represent transportation, affordability or insurance, workforce capacity, provider availability, language access, digital connectivity, scheduling and wait friction, food access, housing context, and other reviewed domains when evidence supports them.

Barrier synthesis must preserve the evidence status of every input. Missing or unsupported evidence remains missing. The runtime must not convert it to zero or invent a score.

A composite index may be introduced only when its variables, directionality, weighting, geography, validation status, and intended use are versioned and approved. Arbitrary formulas and decorative rankings are prohibited.

## Scenario policy

Scenarios are bounded planning calculations, not predictions.

A scenario may run only when:

- the user supplied explicit assumptions;
- assumptions are stored separately from published evidence;
- the denominator and baseline come from governed evidence when required;
- the formula and units are visible and versioned;
- uncertainty and missing inputs are preserved;
- the output is labeled as a scenario output or modeled planning range.

Synthetic reach numbers, invented barrier-reduction percentages, arbitrary cost indices, demo heat points, and unsupported planning-attention scores are prohibited from production CB-CAP.

## Human review and authority

Draft generation must terminate at a review state unless an authenticated approval record is already present. Approval records must identify the actor, scope, decision, time, and object/release being approved.

An agent cannot approve its own work. Human approval is required before publication and before any future external write that could affect a partner, funding workflow, public record, or operational plan.

## Funding intelligence

Funding intelligence is a governed matching and evidence-preparation workflow, not automated allocation.

Future funding nodes may connect verified place needs, plan priorities, eligibility rules, program purpose, deadlines, evidence requirements, and partner roles. They must cite a governed opportunity record and distinguish:

- verified eligibility criteria;
- evidence-supported fit;
- missing information;
- user assumptions;
- drafting assistance;
- human funding decisions.

The runtime must never claim an award is likely, determine final eligibility, or allocate money on behalf of a funder.

## Tool boundary

Every production tool has:

- an allowlisted purpose;
- a typed request and response;
- authorization checks;
- tenant and geography scope;
- evidence/release provenance where applicable;
- timeout and retry policy;
- auditable invocation metadata;
- a kill switch or feature control for consequential capabilities.

Unrestricted live-web retrieval is not permitted inside a public evidence answer. Time-sensitive external sources, including future funding opportunities, must enter through a governed ingestion or retrieval contract with source and retrieval metadata.

## Security and privacy

- No individual medical records in CB-CAP evidence workflows.
- Data minimization by default.
- No area-level evidence may be used to infer an individual's condition or risk.
- Secrets remain server-side.
- Tenant authorization is required before institutional memory or workspace data is read or changed.
- Every consequential graph action produces an audit event.
- Models, prompts, tools, and policies are versioned independently.
- Runtime execution can be disabled without removing the evidence layer.

## Repository migration rule

This repository evolves into the agent execution and control plane. `sozorock-health` remains the evidence and product-surface authority during the migration.

The migration sequence is:

1. establish graph, harness, memory, and Evidence Gateway client contracts;
2. migrate CB-CAP planning execution off the legacy linear Chief of Staff path;
3. remove synthetic scenario and heat-map outputs;
4. replace duplicate source adapters with governed Evidence Gateway consumption where applicable;
5. add authenticated persistent workspace memory and approval records;
6. add evaluated specialist nodes for barriers, CHA/CHIP, funding intelligence, monitoring, and briefs;
7. wire the CB-CAP product surface only after the runtime contracts and safety gates are proven.

No migration step may weaken provenance, evidence semantics, non-clinical boundaries, or human authority.
