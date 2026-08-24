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
- an executable fail-closed production-readiness gate covering runtime configuration, live database role/TLS/RLS/privileges, cross-tenant isolation, Evidence Gateway reachability, identity authority, deployment supply chain and edge controls, backup/restore, observability, and rollback proof;
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

## Evidence and specialist capabilities

The runtime recognizes `sozorock.evidence-gateway.v1` and the additive `sozorock.evidence-gateway.planning.v1` contract. It verifies exact county, release identity, SHA256 package identity, source versions, reviewed metric semantics, source coverage, and planning-document/claim/citation lineage before using governed public evidence.

Specialist capabilities are deliberately bounded:

- CHA/CHIP evidence uses only reviewed exact-county current-plan claims with page or section locators and never treats missing evidence as proof of official-plan omission.
- Funding Intelligence reports requirement match and evidence fit but never final eligibility, award probability, or allocation.
- Visualization Intelligence selects truthful analytical forms and fallbacks from data shape and reviewed semantics rather than rendering a generic chart gallery.
- Scenario Intelligence runs only reviewed deterministic models from explicit user assumptions and labels results as scenario outputs, not predictions.
- Workforce and Capacity Intelligence preserves HPSA scope and reviewed AHRF context without producing a composite shortage score or county rank.
- Monitoring reports governed changes, attention conditions, or blocked evidence without determining the institutional response or silently changing production.
- Tenant-private evidence stays tenant-only, requires rights/security/retention checks and human review, and cannot enter the public Evidence Gateway or institutional truth merely by being accepted for tenant use.

See `docs/` for each capability contract.

## Memory domains

The platform deliberately separates:

1. **Run memory** for immutable execution events, checkpoints, approvals, traces, and evidence releases.
2. **Workspace memory** for authenticated drafts, comments, tasks, saved views, review questions, and collaboration state with optimistic versions and immutable change events.
3. **Institutional memory** for reviewed reusable decisions and operating knowledge represented through append-only proposal, review, expiry, and supersession records.
4. **Learning memory** for structured trajectories, evaluation labels, authorized corrections, regression evidence, and proposed improvements for future reviewed releases.

Learning candidates cannot self-apply. Even an approved candidate remains `not_applied`; no learning-memory method can rewrite production prompts, code, policy, tools, model routing, or institutional truth.

## PostgreSQL authority boundary

Protected runtime state uses tenant ID on every protected row, transaction-local `app.tenant_id`, forced row-level security, reviewed tenant policies, same-tenant relational integrity, and append-only triggers where history must not be rewritten.

The production application role must not own protected tables, be superuser, or hold `BYPASSRLS`. It must receive only the reviewed table privileges required by the runtime.

## Server exposure

Institutional planning, review, funding, visualization, workforce, monitoring, tenant-private evidence, workspace, and institutional-memory routes fail closed without an authenticated institutional gateway. Unknown `/api/...` paths return 404 and cannot fall through to the frontend SPA.

`ENABLE_UNAUTHENTICATED_CBCAP_DEV=true` enables development planning only. It never enables review, funding, visualization, workforce, monitoring, private evidence, workspace, institutional memory, or learning-memory access and is not a production authentication mode.

## Production readiness

Repository CI proves the code contract. Target-environment activation additionally requires `cbcap.production-readiness.v1`.

```bash
CB_CAP_PRODUCTION_READINESS_ADAPTER=/secure/runtime/cbcap-readiness-adapter.js \
AGENTIC_ALLOWED_ORIGINS='https://cbcap.sozorockfoundation.org;https://health.sozorockfoundation.org' \
AGENTIC_ALLOWED_HOSTS='api.cbcap.sozorockfoundation.org' \
AWS_REGION=us-east-1 \
npm run preflight:production
```

The gate exits nonzero unless live configuration, PostgreSQL TLS/role/RLS/privileges, rollback-only cross-tenant isolation, the five-county Evidence Gateway planning contract, Cognito authority, protected-main release identity, OIDC deployment identity, immutable artifact and vulnerability scan, managed secrets/private storage, migration-before-traffic ordering, TLS/edge/security-header/CORS/auth probes, backup/restore, observability, and institutional-runtime rollback are all verified.

See `docs/PRODUCTION_ACTIVATION.md`.

## Superseded draft

Draft PR #2, the earlier Python/FastAPI/ECS foundation, is closed as superseded and was never merged into the production line. Its reusable governance and deployment rules were selectively migrated into the Node runtime. It remains historical source material only, not an alternative production path.

See `docs/SUPERSEDED_DRAFT_MIGRATION.md`.

## Verification

```bash
npm install
npm test
npm audit --omit=dev --audit-level=high
```

Node 24 or later is required.

## Remaining environment activation dependencies

The repository implementation is complete for the currently defined governed capabilities. Live institutional activation still requires target-environment evidence that cannot be manufactured in repository code:

1. run the production-readiness gate against the real AWS Cognito, PostgreSQL, storage, network, backup/restore, observability, deployment, and rollback adapters;
2. enable institutional traffic only after that target environment returns `eligible_for_controlled_activation`;
3. connect a production scheduler or event source for monitoring only after its credentials, retry behavior, destination, and incident handling are verified;
4. add future relationship or other evidence feeds only when reviewed sources exist in the shared Evidence Gateway; absence is never synthesized.

See `ARCHITECTURE.md` for the full control-plane boundary.

## License

MIT