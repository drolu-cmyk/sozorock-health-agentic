# SozoRock Health Agentic Runtime

This repository is the execution and control plane for governed SozoRock Health agents, including the CB-CAP decision workflow.

It is **not** the production public-data warehouse. Governed evidence is supplied by the versioned Evidence Core and Evidence Gateway in `drolu-cmyk/sozorock-health`.

## Current runtime foundation

The current branch introduces the first governed graph contracts:

- append-only run memory;
- a directed execution graph with explicit state transitions;
- deterministic policy harness with allowlists, step budgets, and a kill switch;
- Evidence Gateway contract, release, release-hash, and county identity validation;
- scenario execution only from explicit user assumptions;
- a mandatory human-review state before publication;
- fail-closed behavior when governed evidence identity is inconsistent.

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
  -> await_review     # mandatory unless an authenticated approval is present
  -> publish?         # only after approval
```

The graph is intentionally separate from model choice. Models may change without replacing the workflow, policy, evidence, memory, review, and audit contracts.

## Evidence boundary

Production CB-CAP agents consume governed Evidence Gateway packages. They validate exact geography and release identity before using evidence.

Legacy ACS and CDC PLACES adapters in this repository remain migration assets and fixtures for now. They are not a second production evidence authority and should not be extended as a competing ingest path.

## Scenario boundary

Production scenarios must use explicit user assumptions and source-backed baselines where required. The runtime must preserve formulas, units, uncertainty, missing inputs, and the distinction between published evidence and user assumptions.

Synthetic reach numbers, invented barrier-reduction percentages, arbitrary cost indices, demo heat points, and unsupported planning-attention scores are not acceptable production CB-CAP outputs.

## Memory

The current `InMemoryRunMemory` establishes an append-only event contract for graph runs. It is not the production persistence layer.

The intended production model separates:

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

The existing server and linear Chief of Staff path remain during migration. New production CB-CAP work should target the governed graph runtime rather than adding more behavior to the legacy orchestration path.

## Next migration steps

1. migrate the legacy CB-CAP planning engine onto the governed graph;
2. replace synthetic scenario and heat-map output with governed evidence and explicit assumptions;
3. route production evidence through the Evidence Gateway client;
4. add authenticated persistent workspace memory and approval records;
5. add evaluated specialist graph nodes for barriers, CHA/CHIP, funding intelligence, monitoring, and briefs;
6. connect the CB-CAP product surface only after those runtime gates pass.

See `ARCHITECTURE.md` for the authoritative runtime boundary.

## License

MIT
