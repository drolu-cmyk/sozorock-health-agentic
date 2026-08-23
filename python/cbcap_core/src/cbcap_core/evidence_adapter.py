from __future__ import annotations

from typing import Any

from .gateway import PublicEvidencePackage, assert_public_package
from .models import CountyRunState, GeographyKind, Measure


def _validated_package(
    payload: dict[str, Any] | PublicEvidencePackage,
) -> PublicEvidencePackage:
    return payload if isinstance(payload, PublicEvidencePackage) else assert_public_package(payload)


def _county_measures(
    run: CountyRunState,
    package: PublicEvidencePackage,
) -> list[Measure]:
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

    return [
        item
        for item in package.measures
        if item.geography.kind == GeographyKind.COUNTY and item.geography.county_fips == county_fips
    ]


def select_county_public_evidence(
    run: CountyRunState,
    payload: dict[str, Any] | PublicEvidencePackage,
) -> tuple[list[Measure], str]:
    """Validate a public package and select only evidence for the run's county."""

    package = _validated_package(payload)
    return _county_measures(run, package), package.release_id


def hydrate_public_evidence(
    run: CountyRunState,
    payload: dict[str, Any] | PublicEvidencePackage,
) -> tuple[CountyRunState, list[str], str]:
    """Hydrate one county run from a validated public Evidence Gateway package.

    Matching is by county FIPS, not display label or free text. Unknown/private
    fields fail closed in `PublicEvidencePackage` before they can enter run state.
    """

    measures, release_id = select_county_public_evidence(run, payload)
    if not measures:
        return run, [], release_id

    merged = {item.id: item for item in run.measures}
    for item in measures:
        merged[item.id] = item

    run_payload = run.model_dump(mode="python")
    run_payload["measures"] = list(merged.values())
    hydrated = CountyRunState.model_validate(run_payload)
    return hydrated, [item.id for item in measures], release_id
