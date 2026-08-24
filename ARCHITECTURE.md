# SozoRock Health Agentic Runtime Architecture

## Status

This document is the source of truth for the agent execution boundary. The runtime is a governed control plane for CB-CAP and related SozoRock Health workflows. It is not a second public-data warehouse and must not become one.

Version 0.8 places authoritative workspace identity and tenant resolution ahead of institutional runtime selection. The runtime now has Cognito-compatible identity contracts, explicit role permissions, actor-scoped runtime composition, resumable workflow state, and a tenant-scoped persistence contract.

Production activation still requires the real identity-provider adapter, deployed PostgreSQL controls, recovery, monitoring, and end-to-end institutional tests.

## Product boundary

SozoRock Health remains non-clinical systems infrastructure. The runtime may organize public evidence, identify evidence-supported barriers, prepare planning drafts, test bounded assumptions, and coordinate review. It does not diagnose, triage, prescribe, infer individual medical risk, determine eligibility, allocate funding, or replace an official county decision, CHA, CHIP, or licensed provider.

The operating principle is:

**AI drafts. People decide.**

## Product separation

The products share governed evidence contracts but not product depth.

| Experience | Primary role |
| --- | --- |
| Explore / Place Intelligence | Public, open-access evidence exploration |
| CB-CAP | Authenticated institutional decision workspace for county, public-health, funder, and partner planning |
| Agentic runtime | Server-side identity, tenant routing, execution, policy, run state, orchestration, review gates, and audit |
| Governance console | Internal policy, trace, incident, approval, and model/tool controls |

CB-CAP must not be reduced to an expanded Explore interface. Its value comes from governed workflows, evidence relationships, scenarios, institutional memory, funding intelligence, collaboration, review history, and monitoring.

## Identity and tenant authority

Institutional CB-CAP execution must not begin until the caller has an authoritative workspace identity.

The runtime reuses the collaboration identity taxonomy already defined in `drolu-cmyk/sozorock-health`:

- roles: `foundation_reviewer`, `county_planner`, `community_partner`, `research_funder_viewer`, `evidence_agent`;
- access: `owner`, `contributor`, `viewer`;
- tenant claim: `custom:tenant_id`;
- role claim: `custom:workspace_role`;
- access claim: `custom:workspace_access`.

The Cognito-compatible resolver accepts an opaque bearer access token and an injected `getUser(accessToken)` provider. It maps provider attributes into the shared workspace actor contract. The token is not returned in actor state.

### Actor policy

| Role | Actor type | Create planning run | Approve saved run |
| --- | --- | --- | --- |
| Foundation reviewer | Human | Owner/contributor | Owner/contributor |
| County planner | Human | Owner/contributor | Owner/contributor |
| Community partner | Human | Owner/contributor | No |
| Research/funder viewer | Human | No | No |
| Evidence agent | Agent | No | No |

Viewer access remains read-only. An agent actor can never satisfy a human-review gate.

Authentication and authorization occur before the tenant runtime factory receives an actor. A denied request therefore cannot choose a tenant runtime or load institutional run state.

### Tenant runtime selection

The runtime uses actor-scoped composition instead of a singleton institutional engine.

`createTenantCBCAPRuntimeFactory()` receives the validated actor and constructs a planning runtime using memory scoped to `actor.tenantId`. A later review request for that actor is composed against the same tenant memory. Another tenant cannot see the run through its own memory adapter.

A production memory factory should create `SqlRunMemory` with the authenticated tenant ID and execute its queries under the same PostgreSQL `app.tenant_id` context.

The institutional gateway never falls back to an unauthenticated runtime if a tenant runtime or review capability is unavailable.

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

Production agents must not independently re-fetch CDC, Census, HRSA, or other source data when the governed Evidence Gateway is the approved source for that evidence. Legacy adapters in this repository are migration assets and test fixtures. They are not a competing production evidence authority.

A geography mismatch, unsupported contract, release-identity mismatch, missing required provenance, or unavailable governed evidence fails closed.

## Runtime stack

The institutional execution model is:

`Identity -> Permission -> Tenant runtime -> Agent role -> Graph -> Harness -> Run memory -> Approved tools -> Governed evidence`

Models are replaceable. The durable product value is the identity and authorization contract, graph, policy harness, evidence contracts, review state, memory, tools, evaluation history, and institutional workflow.

### Graph

A graph owns workflow state and explicit transitions. The current CB-CAP path is:

`resolve_place -> load_evidence -> synthesize_barriers -> organize_plan -> scenario? -> draft_brief -> await_review -> publish?`

`scenario` and `publish` are capabilities, not assumptions. A node cannot be reached merely because a model suggests it.

The review halt creates a checkpoint. When a reviewed publish capability exists, the checkpoint declares `publish` as its only resume target. A later approval continues that exact saved run. Geography resolution, Evidence Gateway retrieval, barrier organization, and draft generation are not repeated during approval continuation.

Completed runs are not resumable. A new `run()` call cannot overwrite an existing run ID. A stale or mismatched approval is rejected before the run receives a `run_resumed` event.

Subagents become bounded graph nodes or approved tools rather than unconstrained peers. Future nodes may include local-plan review, funding-opportunity matching, partner mapping, monitoring, evaluation, and portfolio comparison. Each must have a typed input/output contract, evidence boundary, evaluation set, permission requirement, and policy gate before production use.

### Harness

The harness is deterministic runtime policy. At minimum it enforces:

- node allowlists;
- step budgets;
- kill switches;
- exact evidence-contract validation;
- non-clinical boundaries;
- scenario-assumption requirements;
- run and release bound human approval before publish or consequential external action.

Prompt text is not a security or governance control.

## Run state and persistence

Run state is evidence-bearing workflow state, not an unbounded transcript dump.

### Development memory

`InMemoryRunMemory` implements the event contract for development and tests. It records append-only run events and immutable state checkpoints.

### Production persistence contract

`SqlRunMemory` defines the PostgreSQL adapter contract. The schema is `infrastructure/postgres/001_agent_run_memory.sql`.

The schema separates:

- `agent_runs`, which stores tenant-scoped run identity and atomically allocates event sequence numbers;
- `agent_run_events`, which stores append-only events and state checkpoints.

Database controls include:

- tenant ID on every run and event;
- composite run/tenant referential integrity;
- append-only event enforcement through an update/delete rejection trigger;
- row-level security policies using `app.tenant_id`;
- tenant-scoped indexes for run and event retrieval.

The SQL adapter rejects run metadata whose tenant ID conflicts with its configured tenant scope before issuing a database query.

The injected database query layer must execute with an authenticated tenant context that matches the adapter tenant. Production activation also requires a least-privilege application role, managed credentials, transaction-level tenant context, backups, restoration tests, retention rules, observability, and incident procedures.

The SQL adapter is not automatically activated by importing it. The default server does not expose institutional CB-CAP unless an authenticated gateway is explicitly installed.

## Memory layers

The platform separates four kinds of memory:

1. **Run memory** records immutable execution events, checkpoints, approvals, traces, errors, and evidence release identities.
2. **Workspace memory** records authenticated organizational drafts, comments, owners, tasks, saved views, and collaboration state.
3. **Institutional memory** stores reviewed reusable facts such as approved local definitions, partner roles, planning conventions, prior approved decisions, and monitoring commitments.
4. **Learning memory** stores evaluated outcomes and patterns only after review. Model output or ordinary user interaction does not automatically become institutional truth.

Run memory is the current implementation focus. Workspace, institutional, and learning memory remain separate data domains with separate authorization and retention rules.

## Human review and authority

An initial planning request produces a draft. It cannot carry an approval for a draft that does not yet exist.

Approval continuation targets the saved run rather than recomputing it. The approval record binds:

- authenticated reviewer subject;
- authenticated tenant;
- decision;
- `county_plan` scope;
- server-generated review time;
- exact run ID;
- exact Evidence Gateway release ID.

The client supplies only the review decision. Reviewer identity and tenant come from the authenticated workspace actor. Run identity and evidence-release identity come from the saved checkpoint.

The gateway enforces review permission before a tenant runtime is selected. The review service authorizes the actor before loading checkpoint details. Tenant mismatch is denied without exposing institutional state.

An agent cannot approve its own work. Human approval remains required before publication and before any future external write that could affect a partner, funding workflow, public record, or operational plan.

## Server exposure policy

Institutional CB-CAP is closed by default.

Without an authenticated institutional gateway:

- `POST /api/cbcap` returns 404;
- `POST /api/cbcap/runs/:runId/review` returns 404.

The explicit `ENABLE_UNAUTHENTICATED_CBCAP_DEV=true` flag enables a development-only planning route. It is not a production identity mode, does not enable review, and is excluded from the production OpenAPI contract.

Public audit access remains disabled. Legacy unauthenticated session endpoints remain disabled by default.

## Barrier intelligence

A barrier is not a single transportation score. CB-CAP may represent transportation, affordability or insurance, workforce capacity, provider availability, language access, digital connectivity, scheduling and wait friction, food access, housing context, and other reviewed domains when evidence supports them.

Barrier synthesis must preserve the evidence status of every input. Missing or unsupported evidence remains missing. The runtime must not convert it to zero or invent a score.

A composite index may be introduced only when its variables, directionality, weighting, geography, validation status, and intended use are versioned and approved. Arbitrary formulas and decorative rankings are prohibited.

## Scenario policy

Scenarios are bounded planning calculations, not predictions.

A scenario may run only when:

- a reviewed scenario capability is installed for the actor/tenant;
- the user supplied explicit assumptions;
- assumptions are stored separately from published evidence;
- the denominator and baseline come from governed evidence when required;
- the formula and units are visible and versioned;
- uncertainty and missing inputs are preserved;
- the output is labeled as a scenario output or modeled planning range.

Synthetic reach numbers, invented barrier-reduction percentages, arbitrary cost indices, demo heat points, and unsupported planning-attention scores are prohibited from production CB-CAP.

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
- actor and tenant authorization checks;
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
- Bearer tokens and secrets remain server-side and are not stored in actor state.
- Tenant identity comes from the authenticated workspace assignment, not a request parameter or client header.
- Tenant authorization is required before institutional run or workspace data is read or changed.
- Public audit access remains disabled.
- Legacy unauthenticated session endpoints remain disabled by default.
- Every consequential graph action produces an audit event.
- Models, prompts, tools, identities, permissions, and policies are versioned independently.
- Runtime execution can be disabled without removing the evidence layer.

## Repository migration rule

This repository evolves into the agent execution and control plane. `sozorock-health` remains the evidence and product-surface authority during the migration.

Completed foundation steps:

1. establish graph, harness, append-only memory, and Evidence Gateway contracts;
2. migrate CB-CAP planning to governed Evidence Gateway semantics;
3. remove synthetic browser and planning fallbacks;
4. add exact county resolution and hardened HTTP boundaries;
5. bind approval semantics to exact run and evidence release;
6. establish resumable checkpoints and a tenant-scoped PostgreSQL persistence contract;
7. establish shared workspace identity, explicit permissions, and actor-scoped tenant runtime selection.

Next activation gates:

1. wire the actual Cognito `GetUser` provider using the existing SozoRock Health user pool and custom claims;
2. deploy the PostgreSQL run store with least-privilege credentials, transaction tenant context, backup and recovery controls;
3. compose the institutional gateway with the real Cognito resolver and SQL-backed tenant runtime factory;
4. end-to-end test plan creation and same-run review across real identity, tenant, and database services;
5. implement authenticated workspace memory separately from the immutable run log;
6. add verified local CHA, CHIP, and CHNA evidence with page-level citations to the shared Evidence Gateway;
7. add evaluated specialist nodes for CHA/CHIP, funding intelligence, monitoring, and briefs;
8. wire the production institutional CB-CAP surface only after those controls are proven.

No migration step may weaken provenance, evidence semantics, non-clinical boundaries, identity integrity, tenant isolation, or human authority.
