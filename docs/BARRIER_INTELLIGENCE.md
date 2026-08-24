# Barrier Intelligence

Barrier Intelligence is a governed evidence layer, not a universal score. It preserves the Evidence Gateway release identity, metric semantics, geography, source version, uncertainty, coverage assertions, and review state for each barrier observation.

## Contract

`cbcap.barrier-intelligence.v1` consumes only reviewed `sozorock.evidence-gateway.v1` county packages. A barrier observation carries its source measure identity, barrier family, value and unit, universe, direction, comparison policy, data period, uncertainty, exact geography, source version, source coverage, coverage class, geometry rule, and the metric's reviewed permissions for trends, forecasting, aggregation, geography, and visualization.

The layer never returns a composite barrier score. It never converts missing evidence to zero. It never writes tenant-private institutional state back to the public Evidence Core.

## Initial barrier families

The contract recognizes care availability, workforce, affordability and insurance, transportation and travel, food security and food access, housing, utilities, digital access, language and information access, built environment, social connection and support, environmental context, preventive service gaps, and public health capacity.

A source measure is not a barrier merely because its label sounds related. `barrier-registry.js` is an explicit allowlist keyed from reviewed source-measure identities. Unknown or unverified metrics remain unavailable to autonomous barrier analysis.

The initial reviewed mappings include the six public CDC PLACES adverse barrier measures already curated by Evidence Core and official HRSA HPSA and MUA/P designation semantics. Disability remains contextual and is not silently converted into an adverse barrier.

## Coverage and geography

Coverage is machine-readable. `national_complete`, `partial_coverage`, and `local_only` describe the reviewed source family while Evidence Gateway `source_coverage` assertions preserve the observed county/source state such as `complete_with_records`, `complete_no_records`, `partial`, `unavailable`, or `stale`.

Geometry rules travel with each registry entry. County estimates remain county estimates. ZCTA is never called a USPS ZIP boundary. HRSA geographic, population, and facility designations retain their official scope and become whole-county statements only when the source says so.

## Interactions

Barrier interactions are transparent co-occurrence records. Each interaction retains the IDs of all component evidence observations and explicitly states that it is not a causal claim and not a score. No black-box weighting is permitted.

## Downstream authorization

Visualization and forecast work must present a registered metric plus its reviewed Evidence Gateway semantics. Unregistered metrics fail closed. A visualization must appear in `allowed_visualizations`; forecasting requires `forecastable: true`. These controls prevent chart or model selection from outrunning the reviewed evidence semantics.

## Evaluation counties

The contract is geography-neutral across the current five-county evaluation set: Albany NY (`36001`), Schenectady NY (`36093`), Montgomery NY (`36057`), Chester PA (`42029`), and Bexar TX (`48029`). The same query contract and provenance rules apply to each county.
