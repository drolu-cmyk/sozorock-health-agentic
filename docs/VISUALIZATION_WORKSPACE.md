# Visualization Intelligence and analytical workspace

CB-CAP visualization is an analytical system, not a chart gallery. The primary reading path is one focal view, a linked comparison, and a source/method inspector. Every view reads the same canonical observation rows and carries the same evidence fingerprint into accessible and exported output.

## Technical design

The initial workload is asynchronous reviewed evidence rather than a high-frequency stream. A workspace request can carry up to 12 reviewed measures and 200 reviewed geographies. The normal five-county planning view has one primary renderer instance, one linked comparison, one inspector, and one nonvisual table. There is no equal-card dashboard wall.

Renderer ownership is explicit:

- MapLibre GL JS owns reviewed geographic substrates, polygon/point placement, pan/zoom, and geographic selection.
- SVG owns direct-labeled ranking, interval, comparison, and other modest analytical mark counts.
- HTML owns source/method ledgers, accessible values, low-bandwidth fallback, and nonvisual output.
- Canvas or GPU renderers are not selected unless mark volume later justifies them and the analytical contract remains unchanged.

The browser or host application may render MapLibre from the returned `cbcap.visualization-render-package.v1`. Geometry is external to the evidence value state: the join key is the governed geography ID and feature state carries value, value state, uncertainty, and source version. Missingness is never encoded as numeric zero.

## Contracts

A full request is `cbcap.visualization-request.v1`. It contains reviewed metric semantics, reviewed geography identities, exact source versions, canonical observations, evidence release identity, output scope, and the required data-shape facts for deterministic selection.

The selected plan is `cbcap.visualization-plan.v1`. Before a renderer is chosen, CB-CAP checks the metric's `allowed_visualizations`. A non-trendable metric cannot create a trend. A bivariate map requires exactly two reviewed metrics that both permit `bivariate_map`. A service-gap map requires observed component evidence IDs for each derived gap record.

The linked workspace is `cbcap.analytical-workspace.v1`. Its primary view, comparison, inspector, accessible table, and export share one canonical row set and SHA-256 data fingerprint. Selecting a place updates all three linked selections and URL state together.

The render package is `cbcap.visualization-render-package.v1`. Ranked and interval comparisons include direct-labeled SVG. Spatial views expose MapLibre feature state and an accessible HTML fallback. Bivariate maps include a text-decodable 3 × 3 legend.

## Reading path

Large screens show primary evidence first, then linked comparison, then source/method detail. Filters belong near the view they change and do not precede the evidence.

Mobile portrait follows `primary → comparison → inspector → controls`. Hover is never required. A selected geography must be reachable by tap or keyboard and essential values stay visible in text. The accessible table is the low-bandwidth and nonvisual fallback rather than a separate analytical claim.

## Evidence states

Observed, modeled, derived, forecast, scenario, and unavailable values are separate states. `unavailable` carries no numeric value. Uncertainty remains attached to the canonical observation and appears in the inspector, table, and direct-labeled SVG when present.

Public output cannot include tenant-private layers unless the request records an explicit approved public transformation. The visualization API is identity-gated and audits workspace creation by tenant, principal, request, artifact family, renderer, scope, and evidence fingerprint.

## Deterministic selection

County ranking uses a ranked or interval dot view, not a map by reflex. Spatial patterns use a choropleth only when geography is analytically meaningful, reviewed boundary geometry exists, and normalization is valid. Bivariate maps use exactly two measures. Service-gap views visibly separate observed layers from derived gap logic. Trend, distribution, relationship, planning-alignment, funding-fit, and barrier-matrix requests retain the existing fail-closed selection rules.

## Export and failure behavior

Static export carries the same claim, canonical rows, source ledger, artifact family, and data fingerprint as the interactive workspace. Export therefore cannot silently change the analytical statement.

If a requested renderer is not permitted by reviewed metric semantics, the request fails closed. If MapLibre geometry is unavailable, the map cannot be fabricated; the accessible evidence table remains available. Partial and unavailable source coverage stays visible. Stale or future live-data behavior must preserve the last reviewed evidence and mark its state rather than replacing it with an empty chart.

## QA

Acceptance tests cover transportation comparison, non-map ranking, partial PLACES coverage, non-trendable rejection, exactly-two-measure bivariate mapping, observed-versus-derived service gaps, uncertainty retention, five-county linked state without value drift, non-hover access, static/interactive claim parity, tenant-private/public separation, direct-labeled SVG, and MapLibre missing-value feature state.
