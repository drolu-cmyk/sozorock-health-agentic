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
- governed workforce and capacity intelligence that preserves HPSA scope and reviewed AHRF context without a proprietary shortage score, county ranking, or allocation recommendation;
- governed monitoring for evidence releases, local planning documents, funding opportunities, workflow commitments, and evidence expiry;
- governed tenant-private evidence with server-resolved storage identity, rights and retention controls, human review, forced RLS, and strict no-PHI/person-level/secrets admission boundaries;
- tenant-scoped workspace collaboration state with optimistic concurrency and immutable change events;
- append-only institutional memory with explicit proposal, human review, evidence revalidation, expiry, and supersession;
- append-only learning and evaluation memory for trajectories, evaluations, corrections, and reviewed improvement candidates, with no automatic production mutation;
- an executable fail-closed production-readiness gate covering runtime configuration, live database role/TLS/RLS/privileges, cross-tenant isolation, Evidence Gateway reachability, identity authority, backup/restore, observability, and rollback proof;
- no public audit endpoint and no legacy unauthenticated sessions by default.

**AI drafts. People decide.**

## Product boundary

Explore / Place Intelligence is the open public evidence surface. CB-CAP is an authenticated institutional planning workspace. They share governed evidence contracts but not product depth.

CB-CAP may organize evidence, compare places, surface reviewed barriers, structure CHA/CHIP evidence, test explicit scenarios, inspect governed workforce and capacity context, evaluate funding evidence fit, monitor governed changes, use reviewed tenant-private organizational evidence, and prepare reviewable decision artifacts. It does not diagnose, triage, prescribe, infer individual clinical risk, determine final funding eligibility, predict an award, allocate funding, or replace an official county, funder, or licensed-provider decision.

## Identity and authority

The runtime reuses the SozoRock Health workspace roles:

| Role | Plan | Review | Funding evidence match | Visualization | Workforce context | Monitoring | Private evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `foundation_reviewer` | Owner/contributor | Owner/contributor | Yes | Yes | Yes | Yes | Submit/read/review with owner/contributor |
| `county_planner` | Owner/contributor | Owner/contributor | Yes | Yes | Yes | Yes | Submit/read/review with owner/contributor |
| `community_partner` | Owner/contributor | No | Yes | Yes | Yes | Yes | Submit with owner/contributor; read only after review |
| `research_funder_viewer` | No | No | Yes | Yes | Yes | Yes | Read reviewed metadata only |
| `evidence_agent` | No | No | No | Yes, nonconsequential only | Yes, nonconsequential only | Yes, nonconsequential only | Read reviewed metadata only |

Viewer access never grants plan-write or approval authority. `evidence_agent` can inspect governed workforce context, evaluate governed monitoring conditions, help choose a visualization specification, and read reviewed tenant-private metadata applicable to the current geography, but can never submit private evidence or satisfy a human review gate.

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

The planning extension is additive to the public county package and carries reviewed county-specific document metadata, reviewed claim statements, and verified page/section locators. Raw document text, tenant state, funding decisions, approvals, private evidence, and agent run state stay outside the public gateway.

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

## Workforce and Capacity Intelligence

`POST /api/cbcap/workforce/capacity` is authenticated and accepts an exact county FIPS only. Workforce rows and source-coverage assertions are loaded through the same actor-scoped governed Evidence Gateway client used by institutional planning.

The first contract, `cbcap.workforce-capacity.v1`, recognizes reviewed HRSA HPSA designation evidence and an explicit AHRF county-capacity allowlist when those feeds are present in the published Evidence Gateway.

A source-confirmed whole-county HPSA may become county workforce barrier context. Population-group, facility, and source-designation HPSAs remain scoped context and cannot become a county-wide shortage conclusion. Negative evidence is allowed only when primary care, dental, and mental-health HPSA products all have verified complete source-coverage assertions.

AHRF capacity variables are admitted only when their source, exact county, reference year, observation, source version, and metric semantics are reviewed, and their semantics are `contextual` with `context_only` comparison policy.

The capability never produces a composite workforce score, county rank, final shortage verdict, provider-adequacy conclusion, or recommended allocation. Missing governed workforce feeds remain `no_verified_data`; the runtime does not synthesize replacements. See `docs/WORKFORCE_CAPACITY.md`.

## Monitoring Intelligence

`POST /api/cbcap/monitoring/evaluate` is authenticated and feature-gated. The client supplies a reviewed monitor ID and optional as-of date only. The monitor definition and current snapshot come from server-owned governed providers.

Monitoring supports Evidence Gateway releases, reviewed planning documents, funding opportunities, workflow commitments, and evidence expiry. It reports `no_change`, `change_detected`, `attention_required`, or `blocked`. Only actionable or blocked conditions are persisted. Stable finding keys prevent the same unchanged overdue or expired condition from creating daily duplicate findings.

Monitoring never determines the institutional response. It does not send external notifications, change workflows, adopt documents, alter funding decisions, promote institutional memory, or change production automatically. This repository provides the evaluator and finding store; it does not claim a production background scheduler has been deployed. See `docs/MONITORING.md`.

## Tenant-Private Evidence

Private evidence uses `cbcap.tenant-private-evidence.v1`. The client references an opaque `uploadId`; it cannot supply bucket, object key, object version, content hash, KMS key, public-access state, or security-scan state. Those are resolved server-side for the authenticated tenant and validated against an opaque tenant storage partition.

Admission requires versioned KMS-encrypted storage with public access blocked. Unsupported media or incomplete/blocked security scanning is quarantined. Missing usage rights, person-level data, PHI, individual health records, credentials, or secrets is rejected. Submission alone does not authorize use.

Accepted use requires an append-only human review by an authorized county planner or foundation reviewer. The latest review and retention date control availability. Query responses expose only sanitized metadata applicable to a requested geography; they never expose storage location or KMS identity.

Accepted private evidence remains tenant-only. It does not alter the public Evidence Gateway or Explore completeness and does not become institutional truth without a separate governed promotion workflow. See `docs/TENANT_PRIVATE_EVIDENCE.md`.

## Memory domains

The platform deliberately separates:

1. **Run memory** for immutable execution events, checkpoints, approvals, traces, and evidence releases.
2. **Workspace memory** for authenticated drafts, comments, tasks, saved views, review questions, and collaboration state. Writes use optimistic version checks and immutable event history.
3. **Institutional memory** for reviewed reusable decisions and operating knowledge. Records are proposed first, revalidated against governed evidence, promoted only by authorized human review, and retained through expiry or supersession.
4. **Learning memory** for structured trajectories, evaluation labels, authorized corrections, regression evidence, and proposed improvements for future reviewed releases.

All four domains now have distinct runtime/storage contracts. Learning memory is internal to the tenant runtime rather than a public client-write API. An evidence agent may propose an improvement candidate from existing evaluation evidence, but only a human `foundation_reviewer` with write authority may approve it. Even an approved candidate remains `not_applied`: learning memory has no method that changes production prompts, code, policy, tools, model routing, or institutional truth.

See `docs/MEMORY_GOVERNANCE.md`, `docs/MEMORY_API.md`, and `docs/LEARNING_MEMORY.md`.

## PostgreSQL memory, monitoring, and private-evidence contract

`SqlRunMemory`, `SqlWorkspaceMemory`, `SqlInstitutionalMemory`, `SqlLearningMemory`, `SqlMonitoringFindingStore`, `SqlTenantPrivateEvidenceStore`, and the PostgreSQL migrations under `infrastructure/postgres/` provide tenant-scoped identity, append-only execution and decision records, optimistic workspace versions, learning provenance, monitoring findings, private-evidence review history, composite tenant integrity, forced RLS, and `app.tenant_id` policies.

Production application roles must not own the protected tables and must not hold `BYPASSRLS`. Tenant context is transaction-local so pooled connections cannot leak identity between requests. Learning-candidate references and tenant-private evidence reviews are validated against the active tenant rather than relying only on application logic.

## Server exposure

Institutional planning, review, funding, visualization, workforce, monitoring, tenant-private evidence, workspace, and institutional-memory routes fail closed without an authenticated institutional gateway. Unknown `/api/...` paths also terminate with 404 and cannot fall through to the frontend SPA.

The explicit `ENABLE_UNAUTHENTICATED_CBCAP_DEV=true` flag enables development planning only. It does not enable review, funding, visualization, workforce, monitoring, private evidence, workspace, institutional memory, or learning-memory access and is not a production authentication mode.

## Production readiness

Repository CI proves the code contract. Target-environment activation additionally requires the fail-closed `cbcap.production-readiness.v1` gate.

```bash
CB_CAP_PRODUCTION_READINESS_ADAPTER=/secure/runtime/cbcap-readiness-adapter.js \
AGENTIC_ALLOWED_ORIGINS='https://cbcap.sozorockfoundation.org;https://health.sozorockfoundation.org' \
AWS_REGION=us-east-1 \
npm run preflight:production
```

The gate exits nonzero unless live configuration, PostgreSQL TLS/role/RLS/privileges, rollback-only cross-tenant isolation, the five-county Evidence Gateway planning contract, Cognito authority, backup/restore, observability, and institutional-runtime rollback are all verified. See `docs/PRODUCTION_ACTIVATION.md`.

## Verification

```bash
npm install
npm test
npm audit --omit=dev --audit-level=high
```

Node 24 or later is required.

## Remaining activation work

1. add relationship evidence only as reviewed feeds become available through the shared Evidence Gateway; absence is never synthesized;
2. retire the superseded Python/FastAPI draft architecture after the remaining reusable deployment rules are preserved;
3. run the production-readiness gate against the real AWS Cognito, PostgreSQL, backup/restore, observability, managed-secret, network, and rollback adapters before enabling institutional routes;
4. connect a production scheduler or event source only after the monitoring evaluator, persistence, credentials, observability, retry behavior, and alert destination are verified in the target environment.

See `ARCHITECTURE.md` for the full control-plane boundary.

## License

MIT