# CB-CAP Visualization Intelligence

## Purpose

CB-CAP uses visualization to reduce decision effort, not to decorate evidence. The default view is the simplest truthful artifact that answers the institutional question while preserving source, geography, uncertainty, missingness, and review status.

The governing contract is `cbcap.visualization.v1`.

## Reading hierarchy

Every analytical surface follows this order:

1. a question or evidence-bearing insight title;
2. the primary visual comparison;
3. direct labels, units, confidence or missingness state, and source/release context;
4. selection detail and cited evidence on demand;
5. controls adjacent to the evidence they change;
6. a nonvisual table with the same essential values and states.

Essential values cannot exist only in a tooltip.

## Decision routes

| Analytical job | Primary artifact | Fallback |
| --- | --- | --- |
| Spatial pattern where geography matters | County/place choropleth on a quiet administrative map | Sorted dot plot |
| Precise place comparison | Dot plot, interval dot plot when confidence intervals exist | Accessible value table with in-cell graphics |
| Uncertainty | Forest-style interval plot | Estimate and interval table |
| Comparable time change | Line chart or small-multiple lines | Release-value table |
| Incomparable releases | No trend line | Release comparison table |
| Distribution with real distribution data | Histogram or box plot with observations | Quantile table |
| Relationship between reviewed measures | Scatterplot | Paired-value table |
| Place by barrier pattern | Matrix heatmap | Accessible matrix table |
| CHA/CHIP evidence alignment | Document by claim-type evidence matrix | Grouped evidence table |
| Funding evidence fit | Criterion-status matrix/table | Accessible criterion list |
| Proven evidence relationships | Layered node-link graph | Adjacency table |

## Maps

A map is justified only when location, spatial adjacency, boundary, or geographic pattern is part of the reasoning. A place name alone is not enough.

For nationwide and county exploration:

- use the existing MapLibre/vector-tile direction;
- use quiet administrative context rather than a visually dominant basemap;
- keep boundary strokes and labels screen-stable;
- show selection through a separate focus state rather than recoloring the magnitude scale;
- require a defensible denominator or reviewed normalization before area shading;
- use a non-quantitative missing pattern or marker instead of treating missing as zero;
- never infer causation from geographic co-location.

A dot plot is preferred when the primary question is exact comparison or ranking rather than spatial pattern.

## Heatmaps

CB-CAP uses a matrix heatmap for repeated barrier patterns across places. It is not a substitute for a county choropleth and is not a density map.

Rows represent places. Columns represent reviewed barrier domains. Quantitative intensity is used only when values share a defensible comparable scale. Missing or incompatible observations use a visibly separate state.

An ungoverned composite barrier score is prohibited.

## Uncertainty

When confidence intervals or modeled ranges are decision-relevant, they must be visible in the default view. They cannot be hidden behind hover.

Do not interpret overlapping intervals as a formal statistical significance test. Do not fabricate a distribution from aggregate point estimates. Do not smooth time series unless a separately reviewed analytical method requires it.

## Time

A line implies continuity and comparability. CB-CAP draws a line only when measure definition, geography, source methodology, and relevant vintage semantics are proven comparable.

If comparability is unresolved, the system returns a release-by-release table or static small multiples without a connecting trend line.

## Funding

Funding Intelligence does not use gauges, opportunity scores, award probabilities, or red/green eligibility verdicts.

The primary surface is a criterion-status matrix showing reviewed requirement lineage, matched evidence, missing evidence, missing partners, conflicts, deadline state, and human-review caveats.

## CHA/CHIP

The workbench uses a document-by-claim-type evidence matrix with citation-level detail. An absent reviewed claim is labeled as an evidence-record gap. It is not presented as proof that the official plan omits that issue.

Multiple verified-current plans appear as a governance conflict, not an automatic selection.

## Evidence graphs

A node-link graph is allowed only when the underlying edge has a governed relationship type and provenance. Textual similarity does not create an edge.

Prefer a layered reading order over decorative force layouts when the direction is evidence to plan claim to decision artifact to funding criterion.

## Interaction and state

Interactive views preserve:

- geography;
- measure;
- comparison set;
- time range;
- committed selection.

These states must be shareable through URL or an authenticated saved-view contract when persistence is enabled. Hover is preview. Selection is commitment. Every interactive state needs a reset path.

## Mobile

Mobile portrait is a sibling analytical state, not a collapsed desktop afterthought.

The primary evidence appears before filters. Filters use a sheet or drawer and return the user to the affected view. Dense maps support tap plus step-through selection. Map gestures must not trap page scroll. Essential values remain visible without hover.

## Accessibility

Every visualization requires:

- a nonvisual data table or structured alternative;
- keyboard inspection;
- direct labels where practical;
- redundant state encoding beyond color;
- grayscale meaning;
- meaningful selected/focused states;
- static export that preserves the claim, source, units, and caveats.

## Prohibited defaults

- 3D quantitative charts without intrinsic depth;
- rainbow magnitude scales;
- decorative gradients or ambient motion;
- dual axes without a reviewed analytical need;
- hover-only key values;
- missing values treated as zero;
- raw-count choropleths across materially different denominators;
- unreviewed composite scores;
- trend lines across incompatible releases;
- funding score gauges;
- evidence graph edges without provenance.
