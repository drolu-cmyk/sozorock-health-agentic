# Visualization Intelligence and evidence-backed workspace

CB-CAP visualization is an analytical system, not a chart gallery. It has two deliberately separate boundaries.

`POST /api/cbcap/visualizations/spec` is metadata-only. It chooses a deterministic chart or map family from analytical purpose and data-shape metadata. It never accepts raw analytical rows, institutional values, arbitrary renderer code, or caller-supplied evidence packages.

`POST /api/cbcap/visualizations/workspace` is the evidence-backed execution boundary. An authenticated caller supplies only the visualization question, county FIPS values, reviewed source-measure IDs, and an optional selected county. The server retrieves the exact county packages from the actor-scoped Evidence Gateway client and constructs the workspace from reviewed evidence.

## Evidence boundary

The workspace never trusts browser-supplied values, geographies, source versions, uncertainty, coverage status, or metric permissions. Those fields come from the Evidence Gateway package and reviewed Barrier Registry.

A workspace fails closed when:

- an Evidence Gateway package is unavailable
- county FIPS is invalid or duplicated
- requested counties do not share one compatible Evidence Gateway release ID
- a source measure does not resolve to one reviewed semantic definition
- the measure is not registered for Barrier Intelligence
- the reviewed semantic policy does not permit the requested visualization
- a trend is requested for a non-trendable measure
- a selected county is outside the requested county set

Missing or partial coverage remains unavailable. It is never converted to zero or filled merely to complete a map.

## Five-county evaluation set

The locked evaluation counties use the same contract and code path:

- Albany County, New York — 36001
- Schenectady County, New York — 36093
- Montgomery County, New York — 36057
- Chester County, Pennsylvania — 42029
- Bexar County, Texas — 48029

No county-specific scoring or presentation logic is allowed.

## Analytical plans

The workspace supports governed comparison, uncertainty, spatial pattern, relationship, barrier matrix, bivariate map, service-gap, and explicitly reviewed time-change requests.

County ranking uses a ranked or interval dot view rather than a map by reflex. A map is selected only when geography is part of the reasoning and reviewed geometry is available.

A bivariate map requires exactly two reviewed measures. Both measures must explicitly permit `bivariate_map`. The plan carries a decodable three-by-three legend with direct axis labels and preserves missingness outside the quantitative scale.

A service-gap view requires exactly two reviewed evidence layers. Its source layers remain identified as observed or official designation evidence. Gap logic is explicitly derived, has no composite score, carries no causal claim, and cannot be presented as observed source data.

Barrier matrices require reviewed `barrier_matrix` permission. They may compare registered barrier evidence without creating a universal barrier score or mixing incompatible units into one quantitative scale.

## Source and method ledger

Every workspace returns a source/method ledger containing:

- county and Evidence Gateway release identity
- release hash for each county package
- source versions
- reviewed metric semantics
- observation IDs
- source-measure IDs
- data periods
- review status

This ledger is part of the analytical artifact rather than a detached documentation page.

## Linked state

The workspace returns one synchronized selection contract for the primary view, comparison, and inspector. Selecting a county updates the selected county and inspector together. The contract identifies URL-backed keys and separates committed state from ephemeral map or hover state.

The host UI owns navigation, URL state, filters, selection, and panel composition. MapLibre or an SVG/chart renderer owns only its marks and local interaction. Renderers do not fetch evidence or create analytical state.

## Mobile and accessibility

Mobile portrait shows the insight and primary evidence before filters or diagnostic controls. Controls belong in a sheet or drawer and must return the user to the affected evidence. Wide maps may support landscape without making landscape mandatory.

Hover is optional preview only. Essential values are available through text and the required table fallback. Keyboard inspection is required. Missingness, selection, and other states may not depend on color alone.

## Export parity

The workspace creates a deterministic SHA-256 claim ID from the evidence rows that support the analytical statement. Static fallback, accessible table, source ledger, and interactive view must preserve that same claim ID and selection/filter state.

Export is not a second analytical pipeline. It cannot silently change values, exclude missingness, change the selected evidence, or make a stronger claim than the interactive workspace.

## Public and private separation

This workspace consumes the reviewed public Evidence Gateway. Tenant-private evidence and workspace memory are separate authority domains and are not written into Evidence Core by visualization. Public Evidence Gateway data and tenant-private planning state must not be blended into a public artifact without a separately governed approved transformation.

The production API surface remains under `/api/cbcap/*`; the retired `/api/place` composite-scoring path is not part of the production runtime.

## QA

Acceptance coverage includes:

- transportation comparison with source, release, and uncertainty retained
- ranking without reflexive mapping
- partial PLACES HRSN coverage remaining unavailable rather than zero
- non-trendable measure rejection
- exactly-two-measure bivariate mapping with a decodable legend
- observed-versus-derived service-gap separation
- five-county linked selection and source inspection
- no hover-only essential evidence
- static and interactive claim parity
- rejection of incompatible releases and unregistered measures
- rejection of caller-supplied raw values at the HTTP boundary
- authorization before request parsing or Evidence Gateway access
