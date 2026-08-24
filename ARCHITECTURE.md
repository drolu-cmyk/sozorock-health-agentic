# SozoRock Health Agentic Runtime Architecture

## Status

This document is the source of truth for the CB-CAP agent execution boundary. `drolu-cmyk/sozorock-health` remains the governed Evidence Core, Evidence Gateway, and public product-surface authority. This repository is the authenticated institutional execution and control plane and must not become a competing evidence warehouse.

Current runtime: **0.10**.

**AI drafts. People decide.**

The earlier Python/FastAPI/ECS foundation in draft PR #2 is closed as superseded and was never merged into the production line. Reusable product, governance, data, memory, monitoring, workforce, private-evidence, and deployment-hardening rules were selectively migrated into the Node control plane. The old branch is historical source material only.

## Product separation

| Surface | Role |
| --- | --- |
| Explore / Place Intelligence | Open public evidence exploration |
| CB-CAP | Authenticated institutional planning and decision workspace |
| Agentic runtime | Identity, tenant routing, graph execution, specialist capabilities, state, policy, review, memory, monitoring, and private-evidence controls |
| Governance controls | Evidence contracts, permissions, approvals, evaluations, incidents, promotion, kill switches, deployment proof, and activation gates |

CB-CAP earns institutional value through governed workflows, reviewed local-plan evidence, scenario testing, funding evidence matching, workforce context, visualization, collaboration, memory, monitoring, and reviewed tenant-private organizational evidence. It is not an expanded Explore dashboard.

## Authority model

Institutional execution begins only after workspace identity and permission are established.

Identity claims reuse the SozoRock Health collaboration taxonomy:

- tenant: `custom:tenant_id`
- role: `custom:workspace_role`
- access: `custom:workspace_access`
- roles: `foundation_reviewer`, `county_planner`, `community_partner`, `research_funder_viewer`, `evidence_agent`
- access levels: `owner`, `contributor`, `viewer`

Authentication and authorization occur before tenant runtime selection. Tenant identity never comes from an arbitrary request parameter or caller-supplied tenant header.

Human authority remains required for consequential decisions. An agent cannot approve its own work, determine final funding eligibility, allocate funding, promote private evidence into institutional truth, or replace an official CHA/CHIP, county, funder, or licensed-provider decision.

## Runtime stack

```text
Identity
  -> Permission
  -> Actor-scoped tenant runtime
  -> Graph or bounded specialist capability
  -> Harness and policy
  -> Run / workspace / institutional / learning memory boundaries
  -> Approved tools
  -> Governed public or reviewed tenant-private evidence
  -> Human review where consequential
```

Models are replaceable. Durable value resides in contracts, graph state, provenance, permission policy, memory, evaluations, reviewed relationships, source semantics, and institutional workflow.

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

The planning extension carries reviewed county-specific document metadata, reviewed claim statements, and verified page/section citation locators. It excludes tenant state, approval state, private evidence, agent runs, funding decisions, and raw document text.

Production agents do not independently re-fetch CDC, Census, HRSA, or another public source when the shared Evidence Gateway is the approved authority for that evidence.

Tenant-private evidence is separate. It never changes public Explore completeness or enters the public Evidence Gateway merely because a tenant uploads or reviews it.

## County planning graph

The governed county path is explicit:

```text
resolve_place
  -> load_evidence
  -> synthesize_barriers
  -> organize_plan
  -> scenario?            # reviewed capability + explicit assumptions only
  -> draft_brief
  -> await_review
  -> publish?             # exact-run human approval only
```

A review checkpoint records the saved state and, when a reviewed publish capability exists, the only legal resume node. Approval continuation reuses the exact saved run and Evidence Gateway release. It does not repeat geography resolution, evidence retrieval, barrier organization, or drafting.

## Specialist capabilities

### CHA/CHIP evidence workbench

The workbench admits only verified county-specific planning documents, exact one-county scope, verified source versions, human-reviewed claims, verified page or section citation locators, and `verified_current` documents for current-plan evidence.

Missing claim categories are reported as evidence-record gaps, not proof that an official plan omits them. Multiple `verified_current` plans are a governance conflict requiring human resolution.

### Funding Intelligence

Funding Intelligence is read-only evidence matching. Reviewed opportunity criteria and the tenant applicant profile are server-derived. The client cannot post its own criteria or profile and manufacture a favorable result.

The evaluator reports requirement match, incompleteness, conflict, unknown state, evidence fit, missing evidence or partners, official-source lineage, deadline state, and caveats. It does not determine final eligibility, predict an award, recommend allocation, or turn evidence fit into a single opportunity score.

### Visualization Intelligence

Visualization is an analytical contract, not a chart gallery. `cbcap.visualization.v1` chooses the simplest truthful artifact from purpose, data shape, and reviewed semantic metadata.

Primary routes include choropleths only when geography matters and normalization is defensible, dot and interval-dot comparisons, uncertainty views, comparable-vintage trends, real distributions only when distribution data exists, scatterplots without causal inference, barrier matrices with missingness separate from magnitude, CHA/CHIP evidence-alignment matrices, funding criterion-status matrices, and node-link graphs only when governed relationship edges exist.

Blocked visual claims return a simpler fallback rather than a misleading chart. Raw institutional rows and arbitrary renderer code are not accepted by the visualization-spec endpoint. See `docs/VISUALIZATION_INTELLIGENCE.md`.

### Scenario Intelligence

Governed scenarios use `cbcap.scenario.v1`. They are planning calculations, not predictions.

A scenario requires explicit user assumptions stored separately from published evidence, explicit ranges and units, a reviewed server-owned model registration, one verified forecastable exact-county baseline where required, model and method versions, evidence release provenance, an allowed horizon, bounded deterministic arithmetic, and human review before consequential use.

The client cannot submit executable formulas, model implementations, evidence sources, baselines, or probabilities. Blocked scenarios emit no partial usable output. Successful output is labeled `scenario_output`, not a published estimate or statistical prediction. See `docs/SCENARIO_GOVERNANCE.md`.

### Workforce and Capacity Intelligence

`cbcap.workforce-capacity.v1` preserves public workforce evidence as planning context without manufacturing a proprietary shortage index.

A source-confirmed whole-county HPSA may be shown as county workforce barrier context. Facility, population-group, and source-designation HPSAs remain scoped context and cannot be promoted into a county-wide shortage conclusion. Negative HPSA evidence requires verified complete primary-care, dental, and mental-health source coverage.

Reviewed AHRF capacity observations are admitted only through an explicit allowlist with exact-county scope, matching reference year, reviewed source/version/semantics, and `contextual` / `context_only` semantics.

The capability never produces a composite workforce score, county rank, provider-adequacy verdict, or funding allocation. See `docs/WORKFORCE_CAPACITY.md`.

### Monitoring Intelligence

Monitoring evaluates server-owned governed definitions and snapshots for Evidence Gateway release changes, reviewed planning-document changes, funding-opportunity changes and deadlines, workflow commitments, and evidence expiry.

It reports `no_change`, `change_detected`, `attention_required`, or `blocked`. Only actionable or blocked findings persist. Stable finding keys avoid daily duplication of the same unchanged condition.

Monitoring does not determine the response, promote institutional memory, mutate workflows, or change production. This repository provides the evaluator and persistence contract; a production scheduler or event source remains an environment-level activation dependency. See `docs/MONITORING.md`.

### Tenant-Private Evidence

`cbcap.tenant-private-evidence.v1` is a separate tenant authority domain.

The client references an opaque upload ID and supplies governance metadata. Bucket, object key, object version, SHA256 identity, KMS identity, public-access state, and security-scan state are resolved server-side for the authenticated tenant.

Admission requires versioned KMS-encrypted storage and blocked public access. Unsupported media or incomplete security scanning is quarantined. Missing usage rights, person-level data, PHI, individual health records, or credentials/secrets is rejected.

Submission never authorizes use. Accepted use requires append-only human review and unexpired retention. The latest review controls availability. Query responses expose only sanitized metadata and never storage locations or KMS details.

Acceptance does not publish private evidence, alter Explore completeness, approve a plan, or promote the evidence into institutional memory. See `docs/TENANT_PRIVATE_EVIDENCE.md`.

## Barrier intelligence

A barrier is not a transportation score or a single composite. Current governed public pathway evidence uses reviewed compatible measures only. Missing or unreviewed domains remain unavailable.

Future domains may include affordability/insurance, language access, digital connectivity, scheduling/wait friction, food, housing, provider availability, and other local access conditions only as reviewed evidence becomes available.

A composite index requires a separately reviewed methodology covering variables, directionality, weighting, geography, validation, missingness, and intended use. Arbitrary scoring is prohibited.

## Memory domains

Memory is separated by authority and retention purpose:

1. **Run memory**: immutable graph events, checkpoints, approvals, traces, failures, and evidence releases.
2. **Workspace memory**: authenticated drafts, comments, tasks, saved views, review questions, and collaboration state with optimistic versions plus immutable change events.
3. **Institutional memory**: human-reviewed reusable decisions and operating knowledge represented through append-only proposal, review, expiry, and supersession records with evidence revalidation.
4. **Learning memory**: structured trajectories, evaluation labels, authorized corrections, and proposed improvement candidates.

Learning candidates cannot self-apply. Even an approved candidate remains `not_applied`; no learning-memory method can rewrite production prompts, code, policy, tools, model routing, or institutional truth.

## PostgreSQL authority boundary

Protected runtime state includes:

- `agent_runs`, `agent_run_events`;
- `cbcap_workspace_items`, `cbcap_workspace_events`;
- `cbcap_institutional_memory`;
- learning trajectory/evaluation/correction/candidate/review tables;
- `cbcap_monitor_findings`;
- tenant-private evidence documents and reviews.

Each domain uses tenant ID on every protected row, transaction-local `app.tenant_id`, forced row-level security, reviewed tenant policies, composite same-tenant integrity where relationships exist, and append-only triggers where history must not be rewritten.

The production application role must not own protected tables, be superuser, or hold `BYPASSRLS`. It must receive only the reviewed table privileges required by the runtime.

## Server exposure

Institutional routes fail closed without an authenticated gateway: planning, exact-run review, Funding Intelligence, visualization specifications, workforce/capacity, monitoring, tenant-private evidence, workspace memory, and institutional memory.

Unknown `/api/...` routes return 404 and cannot fall through to the frontend SPA.

The explicit unauthenticated development override enables planning only. It never enables review, funding, visualization, workforce, monitoring, private evidence, workspace memory, institutional memory, or learning-memory access.

Public audit access and legacy unauthenticated sessions remain disabled by default.

## Tool and retrieval boundary

Every production tool requires typed purpose and request/response, actor and tenant authorization, evidence/release provenance where relevant, timeout and retry rules, auditable invocation metadata, and capability or kill-switch control when consequential.

Unrestricted live-web retrieval does not become public or institutional truth directly. Time-sensitive sources such as funding opportunities must enter through a governed source/retrieval contract with official URL, retrieval time, review status, and criterion lineage.

## Security and privacy

- no PHI or individual medical records in CB-CAP evidence workflows;
- no area-level evidence used to infer individual condition or risk;
- bearer tokens and secrets remain server-side;
- data minimization by default;
- tenant authorization before institutional state access;
- private storage metadata never crosses into public evidence;
- consequential actions produce audit events;
- models, prompts, tools, identities, permissions, evidence contracts, and policies are versioned independently;
- runtime execution can be disabled without removing public evidence.

## Controlled improvement

The platform may improve through evaluated trajectories, corrections, golden cases, regression tests, and governance-approved promotion. It must not autonomously rewrite its production policy, tools, prompts, model routing, or code based on ordinary interactions.

## Production activation gate

Repository CI is necessary but not sufficient for production activation. The target environment must pass `cbcap.production-readiness.v1` through:

```bash
npm run preflight:production
```

The gate verifies:

- production-safe configuration with development and legacy bypasses disabled;
- explicit HTTPS origin and production host allowlists;
- live TLS PostgreSQL connection;
- non-superuser, non-`BYPASSRLS`, non-owner runtime role;
- every protected table present with forced RLS, expected tenant policy, reviewed privileges, and required append-only trigger;
- rollback-only same-tenant read plus cross-tenant read/write denial and tenant-context cleanup;
- the locked five-county Evidence Gateway proof set on one release with the planning contract;
- real identity/claim, same-tenant, cross-tenant, and human-review authority probes;
- short-lived OIDC deployment identity and approved account/region;
- exact protected-main SHA and immutable release artifact identity;
- release-blocking vulnerability scan result;
- managed secrets, private database networking, and governed private-evidence storage;
- migrations completed before institutional user traffic;
- TLS certificate, edge protection, security headers, CORS, and unauthenticated protected-route denial on the live endpoint;
- backup and completed restore proof;
- logs, audit events, alerts, and incident routing;
- ability to disable or roll back the institutional runtime while public Explore and the Evidence Gateway remain unaffected.

A missing probe blocks activation. See `docs/PRODUCTION_ACTIVATION.md`.

## Completed implementation foundation

1. graph, harness, run memory, and Evidence Gateway contracts;
2. governed county planning and exact geography handling;
3. removal of synthetic planning/browser fallbacks;
4. exact-run human review continuation;
5. Cognito-compatible identity and actor-scoped tenant routing;
6. PostgreSQL run, workspace, institutional, learning, monitoring, and tenant-private evidence contracts with forced RLS;
7. Evidence Gateway package SHA256 validation;
8. reviewed CHA/CHIP planning-evidence transport and workbench;
9. governed Funding Intelligence;
10. visualization intelligence and analytical guardrails;
11. governed scenario intelligence;
12. governed workforce and capacity intelligence;
13. governed workspace and institutional memory;
14. governed learning/evaluation memory without autonomous self-modification;
15. governed monitoring evaluator and finding store;
16. governed tenant-private evidence;
17. fail-closed production-readiness gate;
18. deployment supply-chain, storage, edge, live-security, and rollback proof contract;
19. selective migration of reusable rules from draft PR #2 and closure of that competing architecture as superseded.

## Remaining environment activation dependencies

The repository implementation is complete for the currently defined governed capabilities. Remaining dependencies are target-environment proofs or future evidence inputs, not unfinished application logic:

1. the real AWS environment must provide Cognito, PostgreSQL, storage, network, backup/restore, observability, deployment, edge, and rollback adapters and pass `npm run preflight:production`;
2. institutional traffic must remain disabled until that target environment returns `eligible_for_controlled_activation`;
3. a production monitoring scheduler or event source may be connected only after its credentials, retry behavior, destination, and incident handling are verified;
4. future relationship or other evidence feeds may be added only when reviewed sources exist in the shared Evidence Gateway; absence is never synthesized.

Draft PR #2 is already closed and remains historical only. No activation step may weaken evidence provenance, identity integrity, tenant isolation, non-clinical boundaries, or human authority.
