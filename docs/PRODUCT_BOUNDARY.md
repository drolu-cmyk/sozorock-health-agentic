# CB-CAP Product Boundary

Status: architecture decision for implementation planning

## Product separation

CB-CAP and SozoRock Health Explore are separate products that share verified public evidence infrastructure.

### SozoRock Health Explore

Canonical repository: `drolu-cmyk/sozorock-health`

Canonical surface: `health.sozorockfoundation.org/explore`

Purpose: open public place intelligence.

Explore answers questions such as:

- What does verified public evidence show about this place?
- How does a geography compare with relevant benchmarks?
- What public measures and source lineage are available?

Explore remains open access and does not contain proprietary organization memory, autonomous planning trajectories, private customer data, funding-fit logic, or licensed CB-CAP workflows.

### CB-CAP

Canonical repository: `drolu-cmyk/sozorock-health-agentic`

Canonical surface: `cbcap.sozorockfoundation.org`

Purpose: autonomous community planning intelligence for professional organizations.

CB-CAP answers questions such as:

- Which barriers require planning attention, where do they concentrate, and how do they interact?
- How do CHA, CHIP, CHNA and other plans align or conflict?
- What has changed since the last planning cycle?
- Which planning conditions may worsen or improve under explicit assumptions?
- Which funding opportunities fit verified needs, designations, applicant eligibility and evidence readiness?
- What work should be reviewed, assigned, monitored or refreshed next?

## Shared evidence, separate intelligence

The products may share public evidence through a stable evidence contract. CB-CAP must not fork or duplicate the public evidence source of truth.

Shared evidence may include:

- geography identifiers and boundaries
- source registry and provenance
- metric semantics
- public health measures
- public barrier measures
- ACS context
- HRSA shortage and designation context
- AHRF and AHRQ context
- public CHA, CHIP and related plan references
- source freshness and release metadata

CB-CAP proprietary layers include:

- County Planning Graph
- Barrier Intelligence Graph
- CHA/CHIP and CHNA research trajectories
- organization-specific evidence and memory
- reviewed planning decisions
- funding-fit relationships and evidence readiness
- planning forecasts, scenarios and backtesting history
- autonomous-agent run history
- trajectory evaluations and golden datasets
- policy, authorization and human-review state
- tenant-specific collaboration, permissions and approvals

## Existing code disposition

`drolu-cmyk/sozorock-health/apps/public-site/app/explore` remains the Explore product.

`drolu-cmyk/sozorock-health/apps/platform` is the current CB-CAP demonstration surface and is migration input. It is not the long-term canonical home for proprietary CB-CAP product logic.

`drolu-cmyk/sozorock-health-agentic` becomes the canonical private CB-CAP product repository.

`drolu-cmyk/agentic-ai-sozorock-health` is treated as historical/reference material until a separate inventory confirms whether any unique decisions or implementation should be migrated. No deletion or archive action is implied by this document.

## Architectural rules

1. Public evidence has one authoritative representation.
2. Proprietary CB-CAP state is never written back into the open Explore product by default.
3. Agent-to-agent handoffs use typed state, not unrestricted prose.
4. Workflow state controls transitions. Prompts do not decide authorization or publication.
5. Evidence entering a planning decision carries provenance, source identity, geography, date, extraction method and verification status.
6. Model calls are used only where semantic reasoning adds value. Deterministic work remains code-first and token-free.
7. Every autonomous run is observable, budget-bounded, resumable and auditable.
8. Public documents and web content are untrusted inputs, never executable agent instructions.
9. Human review gates are explicit for high-impact or uncertain planning outputs.
10. Product defensibility is built from accumulated verified evidence relationships, planning history, reviewed decisions, trajectories, evaluations and organization memory, not from a specific model provider.

## Product promise

CB-CAP turns fragmented community evidence into a continuously maintained planning system that shows where barriers exist, how they interact, what may change, what plans already say, what resources may be available, and what needs attention next.
