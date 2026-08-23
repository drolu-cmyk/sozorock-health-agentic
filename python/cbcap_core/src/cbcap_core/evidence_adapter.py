from __future__ import annotations

from typing import Any

from .gateway import PublicEvidencePackage, assert_public_package
from .models import CountyRunState, GeographyKind, Measure


def _merge_measures(existing: list[Measure], incoming: list[Measure]) -> list[Measure]:
    merged = {item.id: item for item in existing}
    for item in incoming:
        merged[item.id] = item
    return list(merged.values())


def hydrate_public_evidence(
    run: CountyRunState,
    payload: dict[str, Any] | PublicEvidencePackage,
) -> tuple[CountyRunState, list[str], str]:
    """Hydrate one county run from a validated public Evidence Gateway package.

    Matching is by county FIPS, not display label or free text. Unknown/private
    fields fail closed in `PublicEvidencePackage` before they can enter run state.
    """

    package = payload if isinstance(payload, PublicEvidencePackage) else assert_public_package(payload)
    county_fips = run.county.county_fips
    if county_fips is None:
        raise ValueError("county run must have county_fips before public evidence hydration")

    matching_geographies = [
        item
        for item in package.geographies
        if item.kind == GeographyKind.COUNTY and item.county_fips == county_fips
    ]
    if len(matching_geographies) != 1:
        raise ValueError(
            f"public Evidence Gateway must contain exactly one county geography for FIPS {county_fips}"
        )

    measures = [
        item
        for item in package.measures
        if item.geography.kind == GeographyKind.COUNTY and item.geography.county_fips == county_fips
    ]
    if not measures:
        return run, [], package.release_id

    run_payload = run.model_dump(mode="python")
    run_payload["measures"] = _merge_measures(run.measures, measures)
    hydrated = CountyRunState.model_validate(run_payload)
    return hydrated, [item.id for item in measures], package.release_id
