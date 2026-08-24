# SozoRock Health Agentic Runtime Architecture

## Status

This document is the source of truth for the CB-CAP agent execution boundary. `drolu-cmyk/sozorock-health` remains the governed Evidence Core, Evidence Gateway, and product-surface authority. This repository is the institutional execution and control plane and must not become a competing evidence warehouse.

Current runtime: **0.9**.

**AI drafts. People decide.**

## Product separation

| Surface | Role |
| --- | --- |
| Explore / Place Intelligence | Open public evidence exploration |
| CB-CAP | Authenticated institutional planning and decision workspace |
| Agentic runtime | Identity, tenant routing, graph execution, specialist capabilities, run state, policy, review, and audit |
| Governance controls | Policy versions, approvals, evaluations, incidents, promotion, and kill switches |

CB-CAP earns institutional value through governed workflows, local-plan evidence, barrier relationships, scenarios, funding evidence matching, visualization, collaboration, memory, and monitoring. It is not an expanded Explore dashboard.

## Authority model

Institutional execution begins only after workspace identity and permission are established.

Identity claims reuse the SozoRock Health collaboration taxonomy:

- tenant: `custom:tenant_id`
- role: `custom:workspace_role`
- access: `custom:workspace_access`
- roles: `foundation_reviewer`, `county_planner`, `community_partner`, `research_funder_viewer`, `evidence_agent`
- access levels: `owner`, `contributor`, `viewer`

Authentication and authorization occur before tenant runtime selection. Tenant identity never comes from an arbitrary request parameter or caller-supplied header.

Human authority remains required for consequential decisions. An agent cannot approve its own work, determine final funding eligibility, allocate funding, or replace an official CHA/CHIP or county decision.

## Runtime stack

```text
Identity
  -> Permission
  -> Actor-scoped tenant runtime
  -> Graph or bounded specialist capability
  -> Harness and policy
  -> Run / workspace / institutional memory boundary
  -> Approved tools
  -> Governed evidence
  -> Human review where consequential
```

Models are replaceable. Durable value resides in contracts, graph state, provenance, permission policy, memory, evaluations, reviewed relationships, and institutional workflow.

## Evidence authority

Production public evidence comes from the Evidence Gateway. The runtime validates:

- gateway contract identity;
- release ID;
- package SHA256 against the manifest;
- exact county geography;
- source versions and review status;
- metric semantics;
- published measures;
- source coverage and missingness;
- the optional planning extension contract when present.

Recognized contracts:

- `sozorock.evidence-gateway.v1`
- `sozorock.evidence-gateway.planning.v1`

The planning extension carries reviewed county-specific document metadata, reviewed claim statements, and verified page/section citation locators. It excludes tenant state, approval state, agent runs, funding decisions, and raw document text.

Production agents do not independently re-fetch CDC, Census, HRSA, or another public source when the shared Evidence Gateway is the approved authority for that evidence.

## County planning graph

The governed county path remains explicit:

```text
resolve_place
  -> load_evidence
  -> synthesize_barriers
  -> organize_plan
  -> scenario?            # only with reviewed capability + explicit assumptions
  -> draft_brief
  -> await_review
  -> publish?             # only through exact-run human approval
```

A review checkpoint records the saved state and, when a reviewed publish capability exists, the only legal resume node. Approval continuation reuses the exact saved run and Evidence Gateway release. It does not repeat geography resolution, evidence retrieval, barrier organization, or drafting.

## Specialist capabilities

### CHA/CHIP evidence workbench

The workbench admits only:

- verified county-specific planning documents;
- exact one-county scope;
- verified source versions;
- human-reviewed claims;
- verified page or section citation locators;
- `verified_current` documents for current-plan evidence.

Missing claim categories are reported as evidence-record gaps, not proof that the official plan omits them. Multiple `verified_current` plans are a governance conflict requiring human resolution.

### Funding Intelligence

Funding Intelligence is read-only evidence matching. Reviewed opportunity criteria and the tenant applicant profile are server-derived. The client cannot post its own criteria/profile and manufacture a favorable result.

The evaluator reports:

- requirement status: matched, incomplete, conflict, unknown;
- evidence fit: strong, partial, weak, not evaluated;
- missing evidence and partners;
- official-source lineage;
- deadline state;
- caveats and human-review requirement.

It does not determine final eligibility, predict an award, recommend allocation, or turn evidence fit into a single opportunity score.

### Visualization Intelligence

Visualization is an analytical contract, not a chart gallery. `cbcap.visualization.v1` chooses the simplest truthful artifact from purpose, data shape, and reviewed semantic metadata.

Primary routes include:

- choropleth only when geography matters and normalization is defensible;
- dot / interval-dot comparison;
- forest-style uncertainty views;
- line or small-multiple trends only across comparable vintages;
- real-distribution views only when distribution data exists;
- scatterplots for association without causal inference;
- barrier matrices with missingness separated from magnitude;
- CHA/CHIP evidence-alignment matrices;
- funding criterion-status matrices;
- node-link graphs only when governed relationship edges exist.

Blocked visual claims return a simpler fallback rather than a misleading chart. Raw institutional rows and arbitrary renderer code are not accepted by the visualization-spec endpoint. See `docs/VISUALIZATION_INTELLIGENCE.md`.

## Barrier intelligence

A barrier is not a transportation score or a single composite. Current governed public pathway evidence includes reviewed compatible measures only. Missing or unreviewed domains stay unavailable.

Future domains may include transportation, affordability/insurance, workforce/service capacity, language access, digital connectivity, scheduling/wait friction, food, housing, provider availability, and rural context as governed evidence becomes available.

A composite index requires a separately reviewed methodology covering variables, directionality, weighting, geography, validation, missingness, and intended use. Arbitrary scoring is prohibited.

## Scenario and forecast policy

Scenarios are planning calculations, not predictions. A future production handler must require:

- explicit user assumptions stored separately from published evidence;
- governed baseline evidence where required;
- visible formula, units, and method version;
- range/uncertainty rather than false point certainty;
- comparable evidence vintages;
- evidence and release provenance;
- evaluation/backtest status where applicable;
- human review before consequential use.

Synthetic reach, invented barrier reduction, arbitrary cost indices, and unsupported forecasts are prohibited.

## Memory domains

Memory is separated by authority and retention purpose:

1. **Run memory**: immutable graph events, checkpoints, approvals, traces, failures, releases.
2. **Workspace memory**: authenticated drafts, comments, tasks, owners, saved views, collaboration state.
3. **Institutional memory**: human-reviewed reusable decisions, definitions, partner roles, accepted facts, commitments.
4. **Learning memory**: evaluated corrections and outcome evidence eligible for governed promotion.

Run memory is currently the production-contract-complete layer. Unreviewed model output or ordinary user interaction never becomes institutional truth automatically.

## PostgreSQL run state

`SqlRunMemory` uses `agent_runs` and append-only `agent_run_events` with:

- tenant ID on every row;
- composite run/tenant integrity;
- atomic sequence allocation;
- forced row-level security;
- `app.tenant_id` policies;
- transaction-local tenant context;
- update/delete rejection for event rows.

The production application role must not own protected tables or have `BYPASSRLS`.

## Server exposure

Institutional routes fail closed without an authenticated gateway:

- planning
- exact-run review
- Funding Intelligence
- visualization specifications

The explicit unauthenticated development override enables planning only. It never enables review, funding, or visualization routes.

Public audit access and legacy unauthenticated sessions remain disabled by default.

## Tool and retrieval boundary

Every production tool requires:

- typed purpose and request/response;
- actor and tenant authorization;
- evidence/release provenance where relevant;
- timeout/retry rules;
- auditable invocation metadata;
- capability or kill-switch control when consequential.

Unrestricted live-web retrieval does not become public or institutional truth directly. Time-sensitive sources such as funding opportunities must enter through a governed source/retrieval contract with official URL, retrieval time, review status, and criterion lineage.

## Security and privacy

- no individual medical records in CB-CAP evidence workflows;
- no area-level evidence used to infer individual condition or risk;
- bearer tokens and secrets remain server-side;
- data minimization by default;
- tenant authorization before institutional state access;
- consequential actions produce audit events;
- models, prompts, tools, identities, permissions, evidence contracts, and policies are versioned independently;
- runtime execution can be disabled without removing public evidence.

## Controlled improvement

The platform may improve through evaluated trajectories, corrections, golden cases, regression tests, and governance-approved promotion. It must not autonomously rewrite its own production policy, tools, prompts, or code based on ordinary interactions.

## Completed foundation

1. graph, harness, run memory, and Evidence Gateway contracts;
2. governed county planning and exact geography handling;
3. removal of synthetic planning/browser fallbacks;
4. exact-run human review continuation;
5. Cognito-compatible identity and actor-scoped tenant routing;
6. PostgreSQL tenant run-state contract with forced RLS;
7. package SHA256 validation;
8. reviewed CHA/CHIP planning-evidence transport and workbench;
9. governed Funding Intelligence;
10. visualization intelligence and analytical guardrails.

## Outstanding implementation and activation gates

1. authenticated workspace memory and reviewed institutional memory;
2. governed scenario/forecast handler;
3. controlled trajectory evaluation and learning promotion;
4. reviewed workforce/capacity and relationship evidence as shared feeds become available;
5. monitoring for evidence, plans, funding records, and commitments;
6. retirement of the superseded Python/FastAPI draft architecture after rule extraction;
7. real production preflight and activation against Cognito, PostgreSQL, backup/recovery, monitoring, Evidence Gateway connectivity, same-tenant continuation, cross-tenant denial, and rollback proof.

No step may weaken evidence provenance, identity integrity, tenant isolation, non-clinical boundaries, or human authority.
