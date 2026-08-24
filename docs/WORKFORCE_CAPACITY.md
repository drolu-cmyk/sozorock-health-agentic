# Governed Workforce and Capacity Intelligence

CB-CAP treats workforce evidence as planning context, not as a proprietary shortage score.

## Evidence authority

The capability reads only the authenticated tenant runtime's governed Evidence Gateway client. A client may request an exact five-digit county FIPS. It may not submit workforce rows, source coverage, model weights, a shortage verdict, or a score.

The first governed rules recognize two public evidence families when they are present in the shared Evidence Gateway:

- HRSA Health Professional Shortage Area designation records under source `hrsa-workforce`;
- reviewed AHRF county capacity variables under source `ahrf-workforce`.

Absence of those feeds from a published package is not replaced with synthetic data.

## HPSA scope

A source-confirmed whole-county HPSA may be shown as county workforce barrier context. Its published HPSA score may be preserved as source evidence, but CB-CAP does not convert it into a proprietary severity score, percentile, rank, or funding recommendation.

Population-group, facility, and source-designation HPSA records remain scoped context. They cannot be promoted into a county-wide shortage conclusion.

A conclusion that no HPSA designation was reported is allowed only when all three required products have verified complete source-coverage assertions:

- primary care;
- dental;
- mental health.

Missing, partial, stale, unverified, duplicated, or internally inconsistent coverage blocks a negative conclusion.

## AHRF capacity

Only a reviewed allowlist of contextual county variables is admitted. Each observation must preserve source version, source observation, exact county, reference year, reviewed metric semantics, and numeric value.

AHRF observations must be marked `contextual` and `context_only`. They are not rankable by this capability and do not establish provider adequacy, appointment availability, quality, causation, or a recommended response.

## Output boundary

The output contract is `cbcap.workforce-capacity.v1`. It always leaves these decision fields unset:

- composite score;
- county rank;
- shortage verdict;
- recommended allocation.

Human judgment remains required. The capability is nonconsequential evidence analysis. Evidence agents may use it, but it grants no plan-write, review, funding, or institutional-memory authority.

## Product separation

Workforce intelligence consumes the shared public Evidence Gateway but is an authenticated CB-CAP analysis capability. Tenant identity and institutional workflow state do not enter the public Evidence Gateway, and CB-CAP does not change public Explore completeness based on private workspace state.
