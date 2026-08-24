# SozoRock Health Agentic Runtime

This repository is the execution and control plane for governed SozoRock Health agents, including the CB-CAP decision workflow.

It is **not** the production public-data warehouse. Governed evidence is supplied by the versioned Evidence Core and Evidence Gateway in `drolu-cmyk/sozorock-health`.

## Version 0.7.0

Version 0.7 adds a resumable workflow-state foundation without exposing approval prematurely.

The runtime now provides:

- append-only graph run events;
- immutable state checkpoints after governed execution steps;
- exact-run resume semantics for a halted human-review state;
- prevention of duplicate execution with an existing run ID;
- pre-authorization of continuation before a saved run is mutated;
- reviewer approval bound to the exact run ID and Evidence Gateway release ID;
- a tenant-scoped PostgreSQL run-memory adapter contract;
- an append-only PostgreSQL event schema with row-level tenant policies;
- an authenticated review-continuation service that derives reviewer identity from an authorizer rather than client input;
- an optional review route that is **not mounted by default**;
- the 0.6 geography, Evidence Gateway, HTTP, CORS, audit, session, and browser-fallback controls.

The operating principle remains:

**AI drafts. People decide.**

## CB-CAP execution path

```text
initial request
  -> resolve one county
  -> load governed Evidence Gateway package
  -> organize reviewed planning evidence
  -> scenario?              # only when a reviewed capability exists and user assumptions permit it
  -> draft brief
  -> human-review halt
  -> state checkpoint

later authenticated review
  -> authorize reviewer and tenant
  -> load exact saved checkpoint
  -> bind approval to run ID + evidence release
  -> resume at approved node only
  -> create approved output
```

Resume does **not** rerun geography resolution, evidence retrieval, barrier organization, or draft generation. A stale or mismatched approval is rejected before a `run_resumed` event is written.

## Public approval boundary

`POST /api/cbcap` creates a planning run and draft. It does not accept approval.

The review continuation route exists only as an injectable capability and is absent from the default server. It may be mounted only after an authenticated authorizer and tenant-scoped durable memory are configured.

Client input never supplies the reviewer identity, tenant, run identity, or evidence-release identity used in an approval record. Those values come from authenticated context and the saved checkpoint.

## Durable run memory

`InMemoryRunMemory` remains the default development store.

`SqlRunMemory` defines the PostgreSQL production adapter contract. The schema is in:

`infrastructure/postgres/001_agent_run_memory.sql`

The schema separates:

- `agent_runs` for tenant-scoped run identity and sequence allocation;
- `agent_run_events` for append-only events and state checkpoints.

The database policy expects each application transaction or connection to set `app.tenant_id` to the authenticated tenant before access. If tenant context is absent, the row-level policy does not match records.

The SQL adapter is intentionally not wired into the public server by default. Deployment must first establish authenticated tenant resolution, a least-privilege application database role, connection-level tenant context, backup/recovery, retention, and operational monitoring.

## Evidence boundary

Production CB-CAP agents consume governed Evidence Gateway packages. They validate exact geography and release identity before using evidence.

Legacy ACS and CDC PLACES adapters in this repository remain migration assets and fixtures. They are not a second production evidence authority and must not be extended as a competing ingest path.

Published population estimates organize questions. They do not establish an official county priority, causal explanation, funding decision, or response recommendation without verified local evidence and accountable human review.

## Memory layers

The platform deliberately separates four kinds of memory:

1. **Run memory**: immutable execution events, checkpoints, approvals, and traces.
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

Node 24 or later is required.

## Next implementation gates

1. integrate a real organization identity provider and tenant resolver;
2. deploy the tenant-scoped SQL run store with least-privilege credentials and recovery controls;
3. mount and end-to-end test the authenticated review continuation against durable storage;
4. build authenticated workspace state separately from the immutable run log;
5. add verified local CHA, CHIP, and CHNA documents with page-level citations to the shared Evidence Gateway;
6. add evaluated specialist graph nodes for CHA/CHIP organization, funding intelligence, monitoring, and briefs;
7. activate the production institutional CB-CAP surface only after those gates pass.

See `ARCHITECTURE.md` for the full runtime boundary.

## License

MIT
