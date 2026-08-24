# SozoRock Health Agentic Runtime

This repository is the governed execution and control plane for SozoRock Health agents and the institutional CB-CAP decision workflow. It is not a second Evidence Core or public-data warehouse. Governed public evidence comes from the versioned Evidence Core and Evidence Gateway in `drolu-cmyk/sozorock-health`.

## Current runtime: 0.10

The control plane now includes:

- explicit graph execution, harness policy, kill switches, and append-only run events;
- exact-run checkpoints and human-review continuation without recomputing the draft;
- authenticated Cognito-compatible workspace identity and actor-scoped tenant runtime selection;
- transaction-local PostgreSQL tenant context and forced row-level security contracts;
- fail-closed institutional HTTP routes and a separate explicit development-only unauthenticated planning path;
- Evidence Gateway package SHA256 verification before governed evidence is used;
- a CHA/CHIP evidence workbench using reviewed current-plan claims and page/section locators;
- feature-gated Funding Intelligence that matches reviewed requirements to governed institutional evidence without determining eligibility or award probability;
- visualization intelligence that chooses evidence-preserving maps, charts, matrices, tables, and fallbacks from data-shape and semantic metadata;
- governed deterministic scenario intelligence with explicit user ranges, reviewed model registrations, verified baselines, source lineage, horizon controls, and no prediction claim;
- tenant-scoped workspace collaboration state with optimistic concurrency and immutable change events;
- append-only institutional memory with explicit proposal, human review, evidence revalidation, expiry, and supersession;
- no public audit endpoint and no legacy unauthenticated sessions by default.

**AI drafts. People decide.**

## Product boundary

Explore / Place Intelligence is the open public evidence surface. CB-CAP is an authenticated institutional planning workspace. They share governed evidence contracts but not product depth.

CB-CAP may organize evidence, compare places, surface reviewed barriers, structure CHA/CHIP evidence, test explicit scenarios, evaluate funding evidence fit, and prepare reviewable decision artifacts. It does not diagnose, triage, prescribe, infer individual clinical risk, determine final funding eligibility, predict an award, allocate funding, or replace an official county, funder, or licensed-provider decision.

## Identity and authority

The runtime reuses the SozoRock Health workspace roles:

| Role | Plan | Review | Funding evidence match | Visualization planning |
| --- | --- | --- | --- | --- |
| `foundation_reviewer` | Owner/contributor | Owner/contributor | Yes | Yes |
| `county_planner` | Owner/contributor | Owner/contributor | Yes | Yes |
| `community_partner` | Owner/contributor | No | Yes | Yes |
| `research_funder_viewer` | No | No | Yes | Yes |
| `evidence_agent` | No | No | No | Yes, nonconsequential only |

Viewer access never grants plan-write or approval authority. `evidence_agent` can help choose a visualization specification but can never satisfy a human review gate.

The identity contract expects Cognito-compatible `custom:tenant_id`, `custom:workspace_role`, and `custom:workspace_access` claims. Authentication and authorization happen before a tenant runtime is selected.

## Governed request path

```text
request
  -> workspace identity
  -> permission policy
  -> actor-scoped tenant runtime
  -> graph / specialist capability
  -> governed evidence + tenant state
  -> draft or analysis
  -> human review where consequential
```

Initial plan creation resolves exactly one county, loads the Evidence Gateway, verifies the package hash and release identity, organizes reviewed evidence, and stops for review. Approval continues the exact saved run and evidence release.

## Evidence Gateway and local plans

The runtime recognizes:

- `sozorock.evidence-gateway.v1`
- `sozorock.evidence-gateway.planning.v1`

The planning extension is additive to the public county package and carries reviewed county-specific document metadata, reviewed claim statements, and verified page/section locators. Raw document text, tenant state, funding decisions, approvals, and agent run state stay outside the public gateway.

The CHA/CHIP workbench:

- uses only verified exact-county current-plan evidence;
- requires reviewed claims and citation locators;
- labels missing categories as evidence-record gaps rather than official-plan omissions;
- surfaces multiple current plans as a governance conflict instead of selecting one automatically.

## Funding Intelligence

`POST /api/cbcap/funding/evaluate` is authenticated and feature-gated. The client supplies an opportunity ID and geographic/as-of context only. Reviewed opportunity criteria and the organization evidence profile come from server-side governed providers.

Outputs distinguish requirement match, incompleteness, conflict, unknown state, evidence fit, missing evidence, missing partners, deadline state, and source lineage. The evaluator never returns a final eligibility verdict, award probability, or funding allocation.

## Visualization Intelligence

`POST /api/cbcap/visualizations/spec` returns a `cbcap.visualization.v1` specification from analytical purpose, data shape, and reviewed measure semantics. Raw institutional rows and arbitrary renderer code are rejected.

The primary routes include:

- choropleth only when geography is analytically meaningful and normalization is defensible;
- interval dot plots for precise place comparison with confidence intervals;
- line or small-multiple views only across proven comparable vintages;
- matrix heatmaps for place-by-barrier patterns with missingness separated from magnitude;
- evidence-alignment matrices for CHA/CHIP;
- criterion-status matrices for Funding Intelligence;
- node-link evidence graphs only when governed relationship edges exist.

Every specification includes a simpler fallback, mobile behavior, accessibility, source/date disclosures, export expectations, and anti-distortion guardrails. See `docs/VISUALIZATION_INTELLIGENCE.md`.

## Scenario Intelligence

Governed scenarios use `cbcap.scenario.v1`. A scenario runs only when an authorized planning request supplies explicit user assumptions and explicit scenario context. The client can supply values, ranges, units, rationale, an as-of date, and a future horizon. It cannot supply executable formulas, model implementations, model versions, evidence sources, baselines, or probabilities.

The tenant runtime selects a server-owned reviewed registration. The registration binds an assumption key to one reviewed source measure, one transparent method, model and method versions, allowed sources, and a maximum horizon. The first contract supports only absolute change, relative fraction, and relative percent arithmetic.

The baseline must be one verified, forecastable exact-county measure from the governed Evidence Gateway. If evidence is missing, duplicated, unreviewed, outside the registered source policy, later than the as-of date, or outside the model horizon, the scenario is blocked and no partial result is exposed as usable output.

Every successful result is labeled `scenario_output`, carries evidence release and baseline lineage, includes the user's range, and states that it is neither a published estimate nor a statistical prediction. It carries no probability of occurrence and remains subject to human review. See `docs/SCENARIO_GOVERNANCE.md`.

## Memory domains

The platform deliberately separates:

1. **Run memory** for immutable execution events, checkpoints, approvals, traces, and evidence releases.
2. **Workspace memory** for authenticated drafts, comments, tasks, saved views, review questions, and collaboration state. Writes use optimistic version checks and immutable event history.
3. **Institutional memory** for reviewed reusable decisions and operating knowledge. Records are proposed first, revalidated against governed evidence, promoted only by authorized human review, and retained through expiry or supersession.
4. **Learning memory** for evaluated outcomes and regression evidence that may improve future behavior only after governance review.

Run, workspace, and institutional memory now have distinct runtime contracts. Learning memory remains intentionally separate so ordinary user interactions, agent output, and approvals cannot autonomously modify production prompts, code, policy, tools, or model routing.

See `docs/MEMORY_GOVERNANCE.md` and `docs/MEMORY_API.md`.

## PostgreSQL memory contract

`SqlRunMemory`, `SqlWorkspaceMemory`, `SqlInstitutionalMemory`, and the PostgreSQL migrations under `infrastructure/postgres/` provide tenant-scoped identity, append-only execution and decision records, optimistic workspace versions, composite tenant integrity, forced RLS, and `app.tenant_id` policies.

Production application roles must not own the protected tables and must not hold `BYPASSRLS`. Tenant context is transaction-local so pooled connections cannot leak identity between requests.

## Server exposure

Institutional planning, review, funding, visualization, workspace, and institutional-memory routes fail closed without an authenticated institutional gateway. Unknown `/api/...` paths also terminate with 404 and cannot fall through to the frontend SPA.

The explicit `ENABLE_UNAUTHENTICATED_CBCAP_DEV=true` flag enables development planning only. It does not enable review, funding, visualization, workspace, or institutional-memory endpoints and is not a production authentication mode.

## Verification

```bash
npm install
npm test
npm audit --omit=dev --audit-level=high
```

Node 24 or later is required.

## Outstanding activation work

1. add controlled trajectory evaluation and learning-memory promotion so the runtime can improve without autonomous self-modification;
2. add governed workforce/capacity and relationship evidence only as reviewed feeds become available through the shared Evidence Gateway;
3. add monitoring for evidence releases, local-plan changes, funding opportunity changes, and workflow commitments;
4. retire the superseded Python/FastAPI draft architecture after its reusable rules are ported;
5. run the production preflight against real Cognito, PostgreSQL, workspace/institutional-memory migrations, backup/recovery, Evidence Gateway connectivity, same-tenant continuation, cross-tenant denial, and rollback controls before activating the institutional runtime.

See `ARCHITECTURE.md` for the full control-plane boundary.

## License

MIT