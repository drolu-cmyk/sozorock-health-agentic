# SozoRock Health Agentic Runtime

This repository is the execution and control plane for governed SozoRock Health agents, including the CB-CAP decision workflow.

It is **not** the production public-data warehouse. Governed evidence is supplied by the versioned Evidence Core and Evidence Gateway in `drolu-cmyk/sozorock-health`.

## Version 0.8.0

Version 0.8 moves tenant identity ahead of institutional runtime selection.

The runtime now provides:

- the same bounded workspace identity taxonomy already used by the SozoRock Health collaboration layer;
- Cognito-compatible access-token resolution through an injected `getUser(accessToken)` provider;
- required `custom:tenant_id`, `custom:workspace_role`, and `custom:workspace_access` claims;
- human-versus-agent actor classification;
- explicit permissions for plan creation and human review;
- authentication and authorization **before** a tenant runtime is selected;
- actor-scoped runtime construction so one singleton engine does not serve multiple organizations;
- shared tenant memory across a plan and later review continuation;
- the version 0.7 exact-run checkpoints, tenant SQL persistence contract, and review continuation controls;
- institutional `/api/cbcap` and review routes that fail closed unless an authenticated gateway is configured;
- an unauthenticated CB-CAP mode available only through the explicit `ENABLE_UNAUTHENTICATED_CBCAP_DEV=true` development override.

The operating principle remains:

**AI drafts. People decide.**

## Workspace identity

The runtime intentionally reuses the existing SozoRock Health collaboration role names rather than creating a second identity taxonomy.

| Role | Actor | Plan creation | Human review |
| --- | --- | --- | --- |
| `foundation_reviewer` | Human | Owner/contributor | Owner/contributor |
| `county_planner` | Human | Owner/contributor | Owner/contributor |
| `community_partner` | Human | Owner/contributor | No |
| `research_funder_viewer` | Human | No | No |
| `evidence_agent` | Agent | No | No |

Viewer access remains read-only regardless of human role. `evidence_agent` is never treated as a human reviewer.

The Cognito-compatible resolver expects:

- `Username` as the principal identity;
- `custom:tenant_id` as the authoritative workspace tenant;
- `custom:workspace_role` as one approved role;
- `custom:workspace_access` as `owner`, `contributor`, or `viewer`;
- `name` or `email` only for display purposes.

Bearer tokens are passed only to the configured identity provider and are never returned in actor state.

## Institutional request path

```text
request
  -> bearer session
  -> identity provider
  -> tenant + role + access
  -> permission policy
  -> tenant runtime factory
  -> tenant-scoped run memory
  -> governed CB-CAP graph
  -> Evidence Gateway
  -> draft
  -> saved review checkpoint

later review
  -> bearer session
  -> review permission
  -> same tenant runtime
  -> exact saved run
  -> run + release bound approval
  -> approved output
```

Authentication occurs before the runtime factory receives an actor. A denied request therefore cannot select a tenant runtime or load institutional run state.

## Tenant runtime composition

`createTenantCBCAPRuntimeFactory()` builds planning and optional review services for the authenticated actor. It passes the actor tenant into the planning engine and expects a memory implementation already scoped to that tenant.

A production `memoryForActor(actor)` implementation should construct `SqlRunMemory` with the authenticated `actor.tenantId` and execute database queries under the same `app.tenant_id` context required by PostgreSQL row-level security.

If no reviewed publish handler is available for the actor, the tenant runtime exposes no review service and the gateway returns service unavailable rather than falling back to an unsafe path.

## Fail-closed server boundary

The default Express server does not expose institutional CB-CAP execution merely because the code exists.

Without `institutionalCBCAPGateway`:

- `POST /api/cbcap` returns 404;
- `POST /api/cbcap/runs/:runId/review` returns 404.

Local development may explicitly enable the older unauthenticated path with:

```bash
ENABLE_UNAUTHENTICATED_CBCAP_DEV=true npm start
```

That flag is a development escape hatch, not a production authentication mode and is intentionally excluded from the production OpenAPI contract.

## Exact-run review state

A planning request creates a draft and saved checkpoint. Approval does not recompute the plan.

Review continuation binds:

- authenticated reviewer subject;
- authenticated tenant;
- review decision;
- `county_plan` scope;
- server-generated review time;
- exact run ID;
- exact Evidence Gateway release ID.

Client input supplies only `decision: "approve"`. A stale or mismatched approval is rejected before a `run_resumed` event is written.

## Durable run memory

`InMemoryRunMemory` remains the development store.

`SqlRunMemory` defines the PostgreSQL production contract. The schema is:

`infrastructure/postgres/001_agent_run_memory.sql`

It provides tenant-scoped run identity, atomic event sequence allocation, append-only event/checkpoint storage, composite run/tenant integrity, and row-level policies using `app.tenant_id`.

The SQL adapter rejects conflicting tenant metadata before querying.

The database adapter is not automatically production-active. Deployment still requires:

- authoritative organization identity and Cognito provider wiring;
- a least-privilege database application role;
- transaction or connection tenant context;
- managed credentials;
- backup and restoration tests;
- retention policy;
- observability and incident procedures.

## Evidence boundary

Production CB-CAP agents consume governed Evidence Gateway packages. They validate exact geography and release identity before using evidence.

Legacy ACS and CDC PLACES adapters in this repository remain migration assets and fixtures. They are not a second production evidence authority and must not be extended as a competing ingest path.

Published population estimates organize questions. They do not establish an official county priority, causal explanation, funding decision, or response recommendation without verified local evidence and accountable human review.

## Memory layers

The platform deliberately separates:

1. **Run memory**: immutable execution events, checkpoints, approvals, traces, and evidence releases.
2. **Workspace memory**: authenticated organizational drafts, comments, owners, tasks, and saved views.
3. **Institutional memory**: reviewed policies, accepted decisions, reusable evidence notes, and approved operating knowledge.
4. **Learning memory**: evaluation results and measured outcomes used to improve routing or agent behavior only after review.

Unreviewed model output must never become institutional truth automatically.

## Quick start

```bash
npm install
npm test
npm start
```

Node 24 or later is required. Institutional CB-CAP is closed by default in this local server unless its authenticated gateway or the explicit development override is configured.

## Next activation gates

1. wire the actual Cognito `GetUser` provider to the identity resolver using the existing SozoRock Health user pool and custom claims;
2. deploy the tenant-scoped PostgreSQL run store with least-privilege credentials, tenant context, backup, recovery, and monitoring;
3. compose the institutional gateway with the Cognito resolver and SQL-backed tenant runtime factory;
4. complete end-to-end plan and exact-run review tests against the deployed identity and database services;
5. build authenticated workspace memory separately from the immutable run log;
6. add verified local CHA, CHIP, and CHNA documents with page-level citations to the shared Evidence Gateway;
7. add evaluated specialist graph nodes for CHA/CHIP organization, funding intelligence, monitoring, and briefs;
8. activate the production institutional CB-CAP surface only after those gates pass.

See `ARCHITECTURE.md` for the full runtime boundary.

## License

MIT
