# CB-CAP Barrier Intelligence v1

Status: source and semantic architecture; no UI implementation yet

## Product purpose

Barrier Intelligence answers four different planning questions that ordinary indicator dashboards usually collapse into one:

1. **What constraint is observed?**
2. **Where is it concentrated?**
3. **What other constraints, service gaps or designations overlap with it?**
4. **What planning action, evidence gap or funding pathway does that combination create?**

CB-CAP must not create one opaque universal barrier score. The primary objects are individual observations, transparent comparisons, geographic concentration, interactions and time-aware evidence.

## Barrier families

The current canonical families are:

- care availability
- workforce
- affordability and insurance
- transportation and travel
- food security and food access
- housing
- utilities
- digital access
- language and information access
- built environment
- social connection and support
- environmental context
- preventive-service gaps
- public-health capacity

These are planning families, not diagnoses or protected-class labels.

## Population-context rule

Age, race, ethnicity, disability, sex and similar population characteristics are not themselves "barriers."

They may be used, where lawful and supported by source methodology, as:

- population context
- accessibility/accommodation context
- disparity evidence
- exposure or service-reach context
- stratification dimensions when the source actually provides valid stratified data

CB-CAP must not convert a demographic characteristic into an adverse barrier score.

## Evidence classes

### A. Nationally reusable baseline evidence

These sources can support broad national coverage when the specific measure and geography are available.

#### U.S. Census Bureau — American Community Survey five-year estimates

Official data: https://api.census.gov/data.html

Useful planning domains include:

- household internet subscription and computer access
- vehicle availability
- housing cost burden and crowding
- poverty and income context
- employment
- language use and English proficiency
- disability/accessibility context
- health-insurance coverage
- commuting and household characteristics

Example current table: `B28002`, Presence and Types of Internet Subscriptions in Household, 2024 ACS five-year estimates.

Rules:

- preserve table, variable, universe, estimate, margin of error and vintage
- do not silently treat a household measure as an individual measure
- comparison and trend permissions are metric-specific
- five-year estimates use overlapping multi-year periods, so a visualization must not imply independent annual samples
- custom geography aggregation requires a documented method

#### HRSA — HPSA and MUA/P

Official data: https://data.hrsa.gov/data/download?titleFilter=Shortage+Areas

HRSA publishes shortage-area files for primary care, dental health and mental health, including geographic, population and facility designations. Current HRSA downloads refresh daily. HPSA/MUA/P designations are also used by more than 34 federal programs for eligibility or funding preference.

Rules:

- preserve discipline, designation type, status, score and source date
- do not convert a population or facility HPSA into a whole-county finding
- model the actual designation geometry where available
- designation status is an authoritative planning fact, not proof of appointment availability
- monitor changes over time; do not forecast designation status by default

#### FCC — Broadband Data Collection / National Broadband Map

Official information: https://help.bdc.fcc.gov/hc/en-us/articles/13532984820379-What-s-on-the-National-Broadband-Map

Fixed-broadband providers report availability location-by-location and providers file BDC data twice a year. Downloadable fixed availability is available in CSV; mobile coverage is distributed in GIS formats.

Rules:

- broadband availability is not the same as affordability or household adoption
- use FCC availability for infrastructure/service availability
- use ACS subscription measures for household adoption/context
- retain technology, speed threshold, provider-reporting vintage and geography transformation method
- challenges and corrections must not be confused with provider availability submissions

#### USDA Economic Research Service — Food Access Research Atlas

Official data: https://www.ers.usda.gov/data-products/food-access-research-atlas

As of July/August 2026, ERS provides two distinct mapping products:

- 2025 SNAP-authorized Retailer Access Map (SRAM), based on 2020 census-tract polygons
- 2019 Large Retailer Access Map (LRAM), based on 2010 census-tract polygons

Rules:

- treat SRAM and LRAM as different measures/methods
- do not merge their values into one continuous time series
- preserve tract-vintage differences
- store retailer access separately from household food insecurity

USDA's Food Environment Atlas can provide additional county-level food-environment context, but it remains a separate source and semantic family from individual or household food insecurity.

### B. Strong but non-uniform national evidence

#### CDC PLACES — Health-Related Social Needs

Official definitions: https://www.cdc.gov/places/measure-definitions/health-related-social-needs.html

The December 2025 PLACES release includes seven health-related social-needs measures:

- loneliness
- receipt of food stamps
- food insecurity
- housing insecurity
- utility services threat
- lack of reliable transportation
- lack of social and emotional support

These are model-based adult prevalence estimates. CDC notes that the health-related social-needs module is not available uniformly in every state; recent releases cover 39 states and the District of Columbia.

Rules:

- never impute missing states merely to create a complete national heat map
- visually distinguish unavailable from low prevalence
- preserve crude/age-adjusted definition and confidence interval
- preserve source survey period
- do not treat a modeled area estimate as a direct local count
- do not use PLACES to claim subgroup disparities because PLACES publishes one estimate per measure per geography rather than stratified estimates by age, sex, race/ethnicity or poverty

#### CDC PLACES — Non-Medical Factors

Official definitions: https://www.cdc.gov/places/measure-definitions/non-medical-factors.html

CDC also presents nine ACS-derived non-medical factors, including housing cost burden, crowding, unemployment and poverty. Because these originate from ACS, CB-CAP should preserve the underlying ACS lineage rather than treating the CDC presentation as a separate independent measurement system.

### C. Local and institutional planning evidence

Examples:

- county/local CHA
- CHIP
- hospital CHNA
- hospital implementation strategy
- state/community health plans
- regional planning documents
- verified program/service directories
- organization-private planning evidence in paid workspaces

Rules:

- narrative evidence is not automatically a numeric measure
- stated priorities are stored as `EvidenceClaim` and `PlanPriority`
- local statements can corroborate or conflict with quantitative evidence
- source geography and plan period must be explicit
- organization-private evidence never crosses the public Evidence Gateway

## BarrierObservation

The existing canonical `BarrierObservation` remains the atomic CB-CAP planning object.

Each observation should eventually carry or reference:

- barrier family
- measure semantics
- geography
- source/version
- observed value when numeric
- uncertainty when available
- comparison context
- evidence quality
- trend permission and result
- concentration/spatial pattern when valid
- related evidence claims

The object must not contain an unexplained composite "risk" score.

## Five analytical layers

### 1. Observation

What the verified source reports.

Example: percent of adults reporting lack of reliable transportation.

### 2. Comparison

How the observation compares with an allowed benchmark or peer group.

The comparator must be methodologically valid and visible to the user.

### 3. Concentration

Where the barrier is geographically concentrated when source resolution supports sub-county analysis.

A county value alone cannot be used to invent tract-level concentration.

### 4. Interaction

Which independently supported barriers, health/service measures or designations overlap.

Examples:

- low vehicle access + long travel + primary-care HPSA
- broadband availability gap + low household subscription + remote-service strategy
- housing pressure + food insecurity + preventive-service gap

An interaction is a transparent combination of verified components, not a hidden score.

### 5. Planning implication

A bounded interpretation connecting the evidence to an existing plan priority, evidence gap, scenario, stakeholder or funding requirement.

This layer may require agent reasoning and review. It must retain the supporting evidence IDs.

## Metric Semantics Registry

Every barrier-related metric must be registered before a visualization or forecasting agent can use it autonomously.

Required semantic fields already exist in `MetricSemantics`:

- direction
- higher-value meaning
- unit
- universe
- adjustment
- comparison policy
- trendable
- forecastable
- aggregatable
- allowed geographies
- allowed visualizations
- review status

Default policy remains fail-closed:

- `trendable = false`
- `forecastable = false`
- `aggregatable = false`
- `allowed_visualizations = []`

A source ingestion pipeline may populate values. It may not grant analytical permissions without a reviewed semantic definition.

## Geography strategy

Barrier Intelligence should use the highest valid resolution supplied or defensibly derived from the source, not the smallest geography available in the UI.

Potential levels include:

- state
- county/county equivalent
- census tract
- Census place
- ZCTA
- planning region
- service/designation geometry
- FCC broadband-service locations or derived summaries where licensed/allowed by source terms

USPS ZIP Code and Census ZCTA must remain separate concepts.

## Time strategy

Every observation is versioned. CB-CAP separates:

- observation date/period
- source release date
- retrieval date
- geography vintage
- methodology/schema version

Trend analysis requires semantic approval across all periods involved.

A changed methodology should normally terminate a continuous trend series or create an explicit break.

## Visualization permissions

Barrier metrics may eventually authorize one or more visual families:

- choropleth
- dot-density or proportional-symbol map when valid
- bivariate map
- tract/ZCTA small multiples
- ranked dot plot
- distribution plot
- uncertainty interval plot
- time series
- change map
- barrier matrix
- service-gap overlay
- designation overlay

A map is not automatically allowed merely because a geography field exists.

## Forecast permissions

Forecasting is more restrictive than trending.

A metric should not be forecastable merely because several historical values exist. Forecast permission requires:

- comparable historical definitions
- enough usable periods
- stable geography/methodology or an explicit reconciliation method
- backtesting design
- uncertainty output
- planning relevance

HRSA designation status, stale food-access layers and partial-coverage social-needs measures are not forecastable by default.

## Paid-product implications

The paid value is not access to these public data sources. Their public facts remain public.

CB-CAP's proprietary value comes from the maintained relationships among:

`barrier -> geography -> evidence -> plan priority -> service/designation -> organization -> scenario -> intervention -> funding -> decision -> outcome`

That relationship history, review state, organization memory and planning trajectory remain in the private product.

## Initial implementation order

1. register existing CB-CAP measures in the semantic registry
2. separate nationally complete, partial-coverage and local-only evidence
3. add tract/ZCTA/service-geometry support where source methodology allows it
4. build explicit barrier interactions
5. expose a barrier query API for the future visualization subgraph
6. validate against the five-county evaluation set
7. only then build the paid Barrier Intelligence UI

## Explicit non-goals

- no universal opaque barrier score
- no demographic characteristic treated as a barrier
- no filling missing states with model guesses
- no fake tract detail derived from county-only values
- no automatic causation claim from correlation or spatial overlap
- no autonomous forecast for an unapproved metric
