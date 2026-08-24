# SozoRock Health Agentic Infrastructure

This repository is the governed execution and control plane for SozoRock Health agentic workflows. It is not a second Evidence Core.

The authoritative public evidence pipeline lives in `drolu-cmyk/sozorock-health`. Production agents consume its reviewed Evidence Gateway contract and preserve release identity, geography, source coverage, metric semantics, and missingness.

## Current foundation

The first governed CB-CAP runtime establishes:

1. An explicit directed graph for county planning work.
2. A deterministic harness with node allowlists, step budgets, and a kill switch.
3. Append-only graph run memory.
4. A fail-closed Evidence Gateway client.
5. Scenario execution only when a user supplies assumptions.
6. A mandatory human review stop before publication.
7. Full graph proof that publication occurs only with an explicit approval record.

## Product boundary

CB-CAP is a distinct institutional planning environment. Explore / Place Intelligence is the open public evidence surface. They may share governed evidence contracts, but they do not share product depth or decision authority.

The agent runtime must never invent production evidence or turn demonstrations into claims. In particular, production CB-CAP must not publish synthetic reach numbers, invented barrier-reduction percentages, arbitrary cost indices, demo heat points, unsupported planning-attention scores, or local priorities that are not backed by governed evidence.

## Legacy migration boundary

The existing ACS and CDC PLACES adapters, linear Chief of Staff pipeline, file-backed sessions, and `CBCAPPlanningEngine` are retained temporarily as migration assets. They are not the target production architecture and must not become a competing ingestion path.

Migration order:

1. Governed graph runtime and Evidence Gateway client.
2. Replace legacy server CB-CAP execution with the graph.
3. Replace file-backed session state with governed durable workflow memory.
4. Retire synthetic scenario and demo heat logic.
5. Add specialized governed subagents only where each agent has a narrow role, tool contract, evidence boundary, evaluation set, and audit record.

## Local validation

```bash
npm install
npm test
```

The repository CI runs on Node 24 with read-only contents permission, pinned GitHub Actions, disabled checkout credentials, tests, and a production dependency audit.

## Non-clinical boundary

The system does not diagnose, triage, prescribe, recommend treatment, infer individual clinical risk, replace licensed care, determine funding eligibility, allocate funding, or replace county or partner judgment.

**AI drafts. People decide.**

## License

MIT
