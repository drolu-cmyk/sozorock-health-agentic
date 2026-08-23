# CB-CAP Implementation Roadmap

Status: working implementation plan

## Phase 0 — Product and repository boundary

Goal: prevent Explore and CB-CAP from becoming one blended codebase or duplicating public evidence.

Deliverables:

- canonical product boundary
- inventory of current CB-CAP demonstration code
- inventory of existing agentic prototype code
- shared evidence contract between Explore evidence infrastructure and CB-CAP
- migration map for reusable UI, metrics, tests and data contracts
- explicit list of proprietary CB-CAP-only assets

Exit test: a developer can identify where every new feature belongs without ambiguity.

## Phase 1 — Canonical state and evidence contracts

Goal: define the typed objects that every graph, agent, visualization and workspace must use.

Core models:

- `GeographyRef`
- `SourceDocument`
- `EvidenceClaim`
- `MetricSemantics`
- `BarrierObservation`
- `BarrierPattern`
- `PlanDocument`
- `PlanPriority`
- `Organization`
- `Measure`
- `FundingOpportunity`
- `FundingFit`
- `ScenarioAssumption`
- `ForecastResult`
- `Conflict`
- `ReviewDecision`
- `AgentRun`
- `CountyRunState`
- `PublicationArtifact`

Required metadata:

- source and publisher
- source URL or stable locator
- published and retrieved dates
- geography
- content hash
- evidence vintage
- extraction method
- verification state
- confidence where appropriate
- tenant visibility
- policy state

Exit test: no agent hands another agent an untyped free-text payload as authoritative state.

## Phase 2 — Shared Evidence Gateway

Goal: let CB-CAP consume the verified public Evidence Core without copying public datasets or implementation logic.

Deliverables:

- versioned read contract
- source freshness contract
- geography resolution contract
- metric semantics contract
- public evidence query contract
- source-lineage contract
- compatibility tests against the existing `@sozorock/evidence-core`

Default design: CB-CAP consumes a stable API or versioned generated evidence package. Direct cross-repository source imports are avoided.

Exit test: Explore and CB-CAP return the same public fact and provenance for the same evidence release.

## Phase 3 — Durable County Planning Graph

Goal: replace the current linear orchestrator with a resumable graph.

Initial graph:

`resolve geography -> establish run state -> fan out research -> validate -> join -> persist evidence -> policy check -> review gate -> complete`

Requirements:

- Python graph runtime
- checkpoint persistence
- idempotent nodes
- deterministic state flags
- parallel fan-out and join
- retry policy
- per-run budget
- run cancellation
- audit events
- human-review interrupts
- model-provider abstraction

Exit test: a failed run resumes from its last valid checkpoint without repeating successful work.

## Phase 4 — Barrier Intelligence

Goal: make barriers a first-class planning system rather than a single score.

Initial families:

- care availability
- workforce
- affordability and insurance
- transportation and travel
- food security
- housing
- utilities
- digital access
- language and information access
- built environment
- social connection
- environmental context where supported
- preventive-service gaps
- public-health capacity

Analytical objects:

- barrier observation
- pressure
- geographic concentration
- overlap
- interaction
- trend
- baseline projection
- scenario
- evidence quality

Exit test: the platform can explain which barriers coexist, where, with what evidence, and why a planning conclusion was reached without hiding the components behind one opaque score.

## Phase 5 — Visualization Intelligence

Goal: make visual analysis a core product workflow, not an export step.

Initial visual families:

- county and sub-county choropleths
- heat maps
- bivariate maps
- small-multiple maps
- service-gap maps
- shortage overlays
- trend lines and uncertainty bands
- ranked dot plots
- distributions
- scatterplots
- barrier matrices
- plan-alignment matrices
- evidence timelines
- scenario comparisons
- funding pipeline views
- implementation timelines
- organization and evidence relationship graphs

Rules:

- visualization selection follows metric semantics
- uncertainty and missingness remain visible
- non-comparable vintages cannot be presented as valid trends
- essential values cannot depend on hover alone
- every view has an accessible non-visual representation
- PDF and spreadsheet are export formats, not the primary analytical experience

Exit test: each major planning question has a defensible default visual chosen from data semantics and decision need.

## Phase 6 — CHA/CHIP and CHNA Research Graph

Goal: automate repetitive evidence discovery and comparison while preserving review and source lineage.

Subagents/nodes:

- official source discovery
- document classification
- multimodal document extraction
- priority extraction
- measure extraction
- stakeholder extraction
- implementation extraction
- hospital CHNA discovery
- cross-plan comparison
- gap detection
- citation verification
- conflict detection

Exit test: for an evaluation county, the graph can find the current official plans, extract priority and implementation evidence with page-level provenance, identify conflicts/gaps, and route uncertainty for review.

## Phase 7 — Evidence Graph and institutional memory

Goal: accumulate relationships that become more valuable over time.

Core relationships:

`geography -> barrier -> measure -> plan -> priority -> action -> organization -> funding -> outcome -> source`

Memory layers:

- session memory
- workflow memory
- county memory
- organization memory
- learning/evaluation memory

Exit test: a new run asks what changed instead of re-researching the county from zero.

## Phase 8 — Forecast and Scenario Engine

Goal: support planning forecasts without presenting clinical prediction or false certainty.

Levels:

- observed
- trend
- baseline projection
- scenario projection

Every forecast stores:

- assumptions
- comparable historical inputs
- method and model version
- uncertainty
- evidence vintage
- backtest results where available
- limitations

Exit test: a reviewer can reproduce the forecast inputs and distinguish observation from projection.

## Phase 9 — Funding Intelligence

Goal: connect verified community need to realistic funding pathways rather than provide generic grant search.

Graph:

`barrier -> evidence -> documented priority -> intervention -> eligible applicant -> designation -> funding program -> opportunity -> partner requirement -> evidence requirement -> deadline`

Subagents/nodes:

- opportunity discovery
- applicant eligibility
- designation matching
- priority alignment
- evidence readiness
- partner fit
- deadline and requirement extraction
- duplicate detection
- verification

Exit test: every recommended opportunity has an explainable fit path and an explicit list of missing evidence or eligibility uncertainties.

## Phase 10 — Paid organization workspace

Goal: turn intelligence into persistent organizational work.

Capabilities:

- tenant identity
- roles and permissions
- county portfolio
- private organization evidence
- team collaboration
- assignments
- approvals
- saved scenarios
- reviewed funding opportunities
- planning decisions
- monitored measures
- change notifications
- audit trail

Exit test: an organization can leave and return without losing the reasoning, evidence, decisions or work status from its prior sessions.

## Phase 11 — Security, GRC and AI governance control plane

Goal: make governance part of runtime behavior.

Controls:

- least privilege
- tenant isolation
- tool allowlists
- typed handoffs
- untrusted-content isolation
- secrets management
- encryption
- spend limits
- rate limits
- policy gates
- model registry
- agent registry
- instruction versions
- trace capture
- kill switches
- security tests
- approval requirements
- rollback support

Exit test: every material autonomous action is attributable, bounded, reviewable and reversible where the action permits reversal.

## Phase 12 — Trajectory evals and controlled learning

Goal: improve the system from verified outcomes without uncontrolled self-modification.

Loop:

`run -> trace -> grade -> correction -> golden case -> proposed improvement -> regression eval -> security/governance checks -> approved promotion`

Evaluate:

- source discovery quality
- source authority
- tool trajectory
- extraction correctness
- geography correctness
- citation correctness
- conflict handling
- review routing
- policy compliance
- cost
- latency
- completion rate

Exit test: a change cannot be promoted merely because its final prose looks better.

## Phase 13 — Commercial pilot

Goal: validate willingness to pay before optimizing enterprise packaging.

Initial paid wedge:

- Barrier Intelligence
- CHA/CHIP Intelligence
- Funding Intelligence
- continuously maintained Planning Brief

Pilot learning questions:

- what recurring work is replaced?
- whose budget owns the problem?
- how many staff hours are currently required?
- which evidence failures cause planning delays?
- which funding and implementation decisions matter most?
- what must remain exportable for boards, councils and grant processes?
- what organization-specific integrations create durable value?

Exit test: at least one design partner can articulate measurable recurring value and a credible budget path.

## Phase 14 — National fan-out

Goal: scale the proven county graph rather than create permanent county agents.

Requirements:

- queued isolated county jobs
- concurrency controls
- source-domain rate limits
- national refresh scheduling
- incremental change detection
- run prioritization
- failure isolation
- national cost telemetry
- coverage and freshness dashboards

Exit test: national research can run as thousands of bounded graph executions without turning each county into a permanently running agent.

## Build principle

The product should get harder to reproduce every month because it accumulates verified relationships, historical planning state, reviewed decisions, evaluation trajectories, funding-fit history, forecast backtests and organization context.

A feature that does not strengthen recurring planning value or a compounding proprietary asset must justify why it belongs in CB-CAP.
