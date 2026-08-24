# SozoRock Health Agentic Runtime

This repository is the execution and control plane for governed SozoRock Health agents, including the CB-CAP decision workflow.

It is **not** the production public-data warehouse. Governed evidence is supplied by the versioned Evidence Core and Evidence Gateway in `drolu-cmyk/sozorock-health`.

## Version 0.6.0

CB-CAP planning now runs through the governed evidence graph introduced in version 0.5.x and the reviewed planning semantics merged in PR #10.

The runtime provides:

- append-only run memory;
- a directed execution graph with explicit state transitions;
- a deterministic policy harness with allowlists, step budgets, and a kill switch;
- Evidence Gateway contract, release, release-hash, and county identity validation;
- an HTTP geography gate that resolves names and ZIP-linked inputs to exactly one county before planning begins;
- explicit selection when a county name or ZIP-linked input maps to more than one county;
- reviewed pathway-barrier semantics with disability kept as accessibility context;
- planned governed states for evidence not yet active, including capacity and geographic context;
- no composite barrier score, automatic priority ranking, synthetic reach, barrier-reduction claim, cost index, hub mix, planning-attention score, or demo heat map;
- scenario execution only when a reviewed scenario capability is installed and explicit user assumptions authorize it;
- complete reviewer, scope, and review-time provenance before a publish-capable graph may produce approved output;
- allowlisted browser origins and no-store API responses;
- public audit access disabled;
- unauthenticated legacy sessions disabled by default;
- no browser-side synthetic CB-CAP fixtures or fallback data.

The operating principle is:

**AI drafts. People decide.**

## CB-CAP path

```text
HTTP request
  -> resolve one county
  -> governed planning engine
  -> load Evidence Gateway package
  -> build reviewed barrier and context view
  -> organize planning evidence
  -> scenario?        # capability must exist and assumptions must be user supplied
  -> draft brief
  -> await human review
  -> approved output? # only if a reviewed publish capability and complete approval record exist
```

The graph is intentionally separate from model choice. Models may change without replacing the workflow, policy, evidence, memory, review, and audit contracts.

## Evidence boundary

Production CB-CAP agents consume governed Evidence Gateway packages. They validate exact geography and release identity before using evidence.

Legacy ACS and CDC PLACES adapters in this repository remain migration assets and fixtures. They are not a second production evidence authority and must not be extended as a competing ingest path.

Published population estimates organize questions. They do not establish an official county priority, causal explanation, funding decision, or response recommendation without verified local evidence and accountable human review.

## Scenario boundary

User assumptions alone do not activate a scenario. A reviewed scenario handler must also be installed. When a scenario capability is enabled, assumptions must be explicitly marked as user supplied and the output must remain labeled as scenario output with its formula, inputs, and limitations.

## Memory and collaboration

`InMemoryRunMemory` establishes the append-only event contract for graph runs. It is not the production persistence layer.

Legacy file-backed sessions are disabled by default. They will be replaced by authenticated durable workspace state rather than promoted into production.

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
2. add same-run resume and review APIs rather than recomputing an approved request;
3. add verified local CHA, CHIP, and CHNA documents with page-level citations to the shared Evidence Gateway;
4. add evaluated specialist graph nodes for CHA/CHIP organization, funding intelligence, monitoring, and briefs;
5. add organization roles, approvals, audit history, and workspace isolation;
6. connect the production CB-CAP institutional surface only after those persistence and authorization gates pass.

See `ARCHITECTURE.md` for the runtime boundary.

## License

MIT
