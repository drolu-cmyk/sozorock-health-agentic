# CB-CAP Visualization Intelligence v1

Status: product and semantic architecture; no paid UI implementation yet

## Purpose

Visualization Intelligence turns verified CB-CAP state into decision views. It is not a chart generator and it is not a gallery of maps.

The governing question is:

**What visual form makes the planning decision easiest to understand without overstating the evidence?**

A visualization agent may choose among approved visual forms. It may not override metric semantics, invent missing geography, hide uncertainty or create unsupported derived values.

## Commercial role

The public Explore product may continue to offer clear public maps and comparisons.

Paid CB-CAP Visualization Intelligence adds:

- linked multi-source analysis
- sub-county analysis where valid
- barrier interactions
- plan and priority alignment
- designation/service overlays
- historical change
- scenario comparison
- forecast uncertainty
- organization-private overlays
- funding/evidence readiness views
- persistent saved analyses
- team annotations and approvals

The paid value is analytical continuity and connected planning state, not access to a chart library.

## First principle: map only when the question is spatial

Use maps for questions such as:

- where is a barrier concentrated?
- where do two conditions overlap?
- where is service availability sparse relative to need?
- which tracts/ZCTAs intersect a designation?
- what communities fall outside a travel-time threshold?

Do not use a map merely because every record has a county name.

For questions such as ranking counties, comparing distributions or understanding correlation, a dot plot, distribution view or scatterplot will usually be clearer.

## Heat-map terminology

CB-CAP must distinguish three different things commonly called a "heat map."

### Choropleth

Administrative/statistical polygons filled according to a normalized measure.

Use for county, tract, ZCTA or other areal rates/percentages when the geography and denominator are valid.

Do not map raw counts with choropleth color unless the analytical question and normalization explicitly justify it.

### Matrix heat map

Rows and columns colored by value.

Use for barrier-by-geography, plan-priority alignment, evidence coverage or organization-capability matrices.

### Spatial density/raster heat map

A continuous-looking intensity field derived from points or raster cells.

Use only when underlying point/raster density supports that representation. Do not blur a county or tract estimate into a false continuous surface.

## Visual request contract

Every autonomous visualization request should eventually provide:

- planning question
- user role
- decision to support
- geography/geographies
- measure IDs
- time range
- comparison group
- source/vintage
- uncertainty fields
- observed/modeled/projected/scenario status
- missingness
- metric semantic permissions
- selected organization/private overlays
- output context: interactive workspace, briefing, export or mobile

The request should not contain a free-text instruction such as "make this compelling" as authority to change analytical meaning.

## Visual plan contract

Before rendering, Visualization Intelligence should produce a typed plan containing:

- visual family
- claim/question title
- required measures
- transformations
- normalization
- geography/projection
- uncertainty treatment
- missing-data treatment
- default state
- interactions
- annotations
- accessibility fallback
- export fallback
- source/method ledger

A renderer receives this plan. The renderer does not decide semantics.

## Core spatial views

### 1. Single-measure choropleth

Use for a rate, percentage or reviewed index across valid comparable polygons.

Required:

- denominator/normalization
- source/vintage
- missing-data encoding
- uncertainty availability
- meaningful class breaks or continuous scale

### 2. Bivariate map

Use when the planning question is explicitly about geographic overlap between two independently supported measures.

Examples:

- transportation barrier + primary-care shortage
- broadband availability + household subscription gap
- preventive-service gap + workforce shortage

The legend must make both dimensions interpretable. Do not use bivariate color for more than two dimensions.

### 3. Small-multiple maps

Use when planners need to compare several barriers without forcing them into a composite score.

Example: transportation, food insecurity, housing pressure and broadband context shown as four synchronized maps with the same geography.

### 4. Change map

Use only when the metric is explicitly approved as trendable and geography/methodology is comparable.

Never infer improvement or deterioration from incompatible releases.

### 5. Service-gap map

Combine a reviewed need/barrier layer with verified service/provider/location evidence.

The view must distinguish:

- observed need
- service location/coverage
- derived gap logic

A service-gap derivation is not the same as an observed source measure.

### 6. Designation overlay

Show authoritative HRSA or other designation geometry over relevant planning measures.

Designation polygons/populations/facilities must retain their actual type and not be flattened into a whole-county yes/no unless that is the source meaning.

### 7. Travel-time/access map

Use when travel is itself part of the planning question.

Inputs must specify mode, threshold, route source, date/time assumptions where relevant and destination set. A straight-line radius must never be labeled travel time.

### 8. Point and facility map

For hospitals, health centers, community organizations, food retailers or other facilities.

Dense points require clustering, step-through inspection or other overlap handling rather than unreadable marker piles.

## Core non-spatial views

### Ranked dot plot

Preferred for precise county/peer comparisons.

### Distribution plot

Shows where a county sits within a peer, state or national distribution rather than reducing the comparison to a rank alone.

### Trend line with uncertainty

Use only for registered trendable measures. Confidence intervals/margins of error should remain visible when material.

### Slope/change view

Useful for a small number of comparable periods and entities.

### Scatterplot

Use to inspect relationships such as workforce capacity versus preventive-service use. The interface must not label correlation as causation.

### Barrier matrix

Rows = geographies or communities; columns = barriers; cells = reviewed comparable values/status.

Useful for seeing different barrier patterns without producing a composite score.

### Plan-alignment matrix

Rows/columns may compare county CHA, CHIP, hospital CHNA, implementation strategies, priorities and measures.

This view can surface agreement, missing links and competing priorities.

### Evidence timeline

Shows source releases, CHA/CHIP cycles, CHNAs, designations, implementation commitments and major evidence changes over time.

### Scenario comparison

Baseline versus scenario assumptions and results with uncertainty and explicit assumptions.

### Funding pipeline

Stages such as discovered, eligibility-reviewed, evidence-ready, partner-needed, preparing, submitted, awarded or closed. Do not imply application or award status from opportunity matching alone.

### Network graph

Use only when relationships among plans, organizations, priorities, interventions or funding are the analytical question. Avoid decorative "knowledge graph" hairballs.

### Gantt/timeline

Use for actual CHIP implementation work, milestones, dependencies and accountable parties.

### Sankey/alluvial

Use only when a real flow exists, such as funding/resources moving through organizations to programs. Do not use merely to show category relationships.

## Observed versus modeled versus projected

Every view must visually and textually distinguish:

- observed/reported
- modeled estimate
- derived planning indicator
- forecast projection
- user scenario
- qualitative plan claim

A projection must never look identical to a verified observed value without a visible label/state distinction.

## Missing data

Missing means missing.

The renderer must not map:

- unavailable as zero
- unsupported geography as low value
- stale as current
- partial PLACES HRSN state coverage as a complete national field

Missingness should be visible in the map/table and inspectable in the source ledger.

## Uncertainty

Where sources provide confidence intervals or margins of error, the visual plan decides whether uncertainty is:

- shown directly
- available in the inspector
- encoded as interval bars
- used to suppress unreliable comparison claims

The system must not rank two estimates as meaningfully different merely because their point estimates differ.

## Workspace composition

CB-CAP should not use a wall of equal-weight cards.

Desktop structure:

- dominant analytical viewport
- compact navigation/analysis rail
- synchronized layer/filter controls
- selected-place inspector
- comparison tray
- source/method status
- run/agent status only when relevant to the user's task

Map, chart and inspector selections stay synchronized and share URL state when a view is shareable.

## Mobile

Mobile is a sibling analytical path, not a squeezed desktop dashboard.

Requirements:

- visualization appears before large settings panels
- filters/layers open as sheets/drawers
- tap/keyboard-equivalent inspection, no hover-only evidence
- dense map targets support search or next/previous stepping
- reduced marker/label density
- clear reset path
- graceful stale/offline/low-bandwidth state

## Rendering stack

### MapLibre GL JS

Primary interactive vector-map layer for CB-CAP because it supports modern data-driven map styling without making proprietary map logic depend on a single commercial map vendor.

### deck.gl

Add when very high mark counts, aggregation, high-volume point layers, arcs/flows or GPU-heavy layers justify it.

Do not add it for ordinary county/tract choropleths.

### D3

Use for custom analytical charts, distributions, matrix views, annotations and compact SVG-based figures.

### Canvas

Use for dense 2D analytical marks when SVG/DOM becomes inefficient.

The renderer is chosen after the visual plan, not before it.

## Basemap strategy

Default analytical maps use a quiet neutral basemap or administrative substrate so roads/POIs do not compete with evidence.

Use road context only when access/travel/service location makes roads analytically relevant.

## Accessibility

Every visual requires:

- keyboard-accessible controls
- non-color-only selected state
- sufficient contrast
- direct/adjacent legend
- text summary of the primary comparison
- tabular or structured alternative for essential values
- reduced-motion behavior
- no critical hover-only information

## Visualization agent governance

The Visualization Intelligence agent may:

- choose among `MetricSemantics.allowed_visualizations`
- choose layout and interaction from approved patterns
- recommend that a map is inappropriate
- add explanatory annotations supported by evidence

It may not:

- set `trendable` or `forecastable`
- invent an unavailable geography
- aggregate an unapproved measure
- change a denominator
- create causal language from correlation
- hide missingness
- remove uncertainty to make a story cleaner
- expose tenant-private layers to a public artifact

## Evaluation

Trajectory evaluation should test not only whether the final chart looks correct but whether the system:

- chose an allowed visual family
- selected the right denominator
- preserved geography and vintage
- handled missing data correctly
- surfaced uncertainty
- avoided misleading trend claims
- respected public/private layer boundaries
- produced the same values as the Evidence Gateway/CB-CAP state

## First build sequence

1. finish Barrier Intelligence semantic registry
2. define typed `VisualizationRequest` and `VisualizationPlan`
3. implement deterministic chart-selection rules
4. implement one linked map + ranked comparison + inspector using the five-county fixture
5. add tract/ZCTA layers only when source evidence is available at that resolution
6. add barrier matrix and plan-alignment matrix
7. add trajectory evals and accessibility tests
8. only then expand into scenarios, funding, networks and implementation timelines

## Explicit non-goals

- no decorative 3D maps
- no rainbow magnitude scales
- no map for every question
- no chart selected only because it looks sophisticated
- no generic equal-card dashboard
- no visual that requires hover to understand the central claim
- no export-first product design
