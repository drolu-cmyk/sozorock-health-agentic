# SozoRock Health Agentic Runtime

This repository is the execution and control plane for governed SozoRock Health agents, including the CB-CAP decision workflow.

It is **not** the production public-data warehouse. Governed evidence is supplied by the versioned Evidence Core and Evidence Gateway in `drolu-cmyk/sozorock-health`.

## Version 0.6.0

The CB-CAP server path now runs through the governed graph rather than the retired synthetic planning engine.

The runtime provides:

- append-only run memory;
- a directed execution graph with explicit state transitions;
- deterministic policy harness with allowlists, step budgets, and a kill switch;
- Evidence Gateway contract, release, release-hash, and county identity validation;
- explicit county selection for ambiguous and multi-county geography;
- source-backed barrier classification using a reviewed CDC PLACES allowlist;
- no composite barrier score or unsupported county-priority rank;
- scenario arithmetic only from explicit user assumptions;
- a mandatory human-review state;
- complete approval provenance before approved output;
- no external publication side effect from the runtime approval step;
- allowlisted CORS and `no-store` API responses;
- public audit access disabled;
- unauthenticated legacy sessions disabled by default;
- no browser-side synthetic county, scenario, hub-mix, or heat-map fallback.

The operating principle is:

**AI drafts. People decide.**

## CB-CAP graph

```text
resolve_place
  -> load_evidence
  -> synthesize_barriers
  -> organize_plan
  -> scenario?        # only with explicit user assumptions
  -> draft_brief
  -> await_review     # mandatory without a complete human approval record
  -> publish?         # produces approved output; no external publication side effect
```

The graph is intentionally separate from model choice. Models may change without replacing the workflow, policy, evidence, memory, review, and audit contracts.

## Evidence boundary

Production CB-CAP agents consume governed Evidence Gateway packages. They validate exact geography and release identity before using evidence.

Legacy ACS and CDC PLACES adapters in this repository remain migration assets and fixtures. They are not a second production evidence authority and must not be extended as a competing ingest path.

The retired `CBCAPPlanningEngine` and its synthetic reach, barrier-reduction, cost-index, planning-attention, and demo heat outputs have been removed.

## Scenario boundary

A scenario may use only assumptions explicitly marked as user supplied. Version 0.6.0 permits bounded arithmetic such as `reachablePopulation × uptakeRate` when both values are supplied by the user.

Scenario output is a planning calculation, not a forecast, measured impact, funding determination, or clinical demand prediction.

## Memory and collaboration

`InMemoryRunMemory` establishes the append-only event contract for graph runs. It is not the production persistence layer.

Legacy file-backed sessions remain available only behind an explicit server flag and are disabled by default. They will be replaced by authenticated durable workspace state rather than promoted into production.

The intended durable model separates:

1. run events and traces;
2. authenticated workspace state;
3. reviewed institutional memory;
4. evaluated learning memory.

Unreviewed model output must not become institutional truth automatically.

## Quick start

```bash
npm install
npm test
npm start
```

Node 24 or later is required.

## Next migration steps

1. replace in-memory graph memory with authenticated durable workflow storage;
2. add explicit resume/review APIs that continue the same run instead of recomputing an approved request;
3. add verified local CHA, CHIP, and CHNA document evidence with page-level citations to the shared Evidence Gateway;
4. add evaluated specialist graph nodes for CHA/CHIP organization, funding intelligence, monitoring, and briefs;
5. add organization roles, approvals, audit history, and workspace isolation;
6. connect the production CB-CAP product surface only after those persistence and authorization gates pass.

See `ARCHITECTURE.md` for the authoritative runtime boundary.

## License

MIT
