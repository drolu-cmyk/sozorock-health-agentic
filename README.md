# SozoRock Health Agentic Runtime

This repository is the governed execution and control plane for SozoRock Health agents and the institutional CB-CAP decision workflow. It is not a second Evidence Core or public-data warehouse. Governed public evidence comes from the versioned Evidence Core and Evidence Gateway in `drolu-cmyk/sozorock-health`.

## Current runtime: 0.9

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

## Memory domains

The platform deliberately separates:

1. **Run memory** for immutable execution events, checkpoints, approvals, traces, and evidence releases.
2. **Workspace memory** for authenticated drafts, comments, owners, tasks, saved views, and collaboration state.
3. **Institutional memory** for reviewed reusable decisions, policies, definitions, partner roles, and operating knowledge.
4. **Learning memory** for evaluated outcomes and regression evidence that may improve future behavior only after governance review.

Only run memory is currently production-contract complete. The remaining memory domains must keep separate authorization, retention, provenance, and promotion rules.

## PostgreSQL run-state contract

`SqlRunMemory` and `infrastructure/postgres/001_agent_run_memory.sql` provide tenant-scoped run identity, atomic sequence allocation, append-only events, composite tenant integrity, forced RLS, and `app.tenant_id` policies.

Production application roles must not own the protected tables and must not hold `BYPASSRLS`. Tenant context is transaction-local so pooled connections cannot leak identity between requests.

## Server exposure

Institutional planning, review, funding, and visualization routes fail closed without an authenticated institutional gateway. The explicit `ENABLE_UNAUTHENTICATED_CBCAP_DEV=true` flag enables development planning only. It does not enable review, funding, or visualization endpoints and is not a production authentication mode.

## Verification

```bash
npm install
npm test
npm audit --omit=dev --audit-level=high
```

Node 24 or later is required.

## Outstanding activation work

1. deploy authenticated workspace and institutional memory separately from the immutable run log;
2. add a governed scenario/forecast handler with explicit assumptions, formulas, ranges, comparability, model/method version, and evaluation status;
3. add controlled trajectory evaluation and promotion so the runtime can improve without autonomous self-modification;
4. add governed workforce/capacity and relationship evidence only as reviewed feeds become available through the shared Evidence Gateway;
5. add monitoring for evidence releases, local-plan changes, funding opportunity changes, and workflow commitments;
6. retire the superseded Python/FastAPI draft architecture after its reusable rules are ported;
7. run the production preflight against real Cognito, PostgreSQL, backup/recovery, Evidence Gateway connectivity, same-tenant continuation, cross-tenant denial, and rollback controls before activating the institutional runtime.

See `ARCHITECTURE.md` for the full control-plane boundary.

## License

MIT
