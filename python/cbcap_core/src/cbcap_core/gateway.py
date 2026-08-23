from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .models import (
    GeographyRef,
    Measure,
    MetricSemantics,
    ReviewStatus,
    SourceVersionRef,
    StrictModel,
)


SHARED_EVIDENCE_CONTRACT_VERSION = "sozorock.evidence-gateway.v1"

ObservationGeographyLevel = Literal[
    "state",
    "county",
    "census_place",
    "zcta",
    "postal_zip",
    "planning_region",
    "census_tract",
    "county_subdivision",
    "population_group",
    "facility",
    "source_designation",
]


class GeographyRelationshipRef(StrictModel):
    id: str = Field(min_length=1)
    from_geography_id: str = Field(min_length=1)
    to_geography_id: str = Field(min_length=1)
    kind: Literal[
        "contains",
        "intersects",
        "overlaps",
        "approximates",
        "member_of",
        "plan_applies_to",
    ]
    source_version_id: str = Field(min_length=1)
    vintage: str = Field(min_length=1)
    overlap_area_percent: float | None = Field(default=None, ge=0, le=100)
    overlap_population_percent: float | None = Field(default=None, ge=0, le=100)
    method: str = Field(min_length=1)
    caveat: str | None = None
    review_status: ReviewStatus


class PublicEvidenceMeasure(Measure):
    """Public measure plus source scope required for safe downstream reasoning.

    The fields are optional for backward-compatible v1 fixtures. New gateway
    output supplies them. A specialist requiring scope must fail closed when the
    scope is absent rather than infer it from the county container geography.
    """

    geography_level: ObservationGeographyLevel | None = None
    source_metadata: dict[str, str | float | bool | None] = Field(default_factory=dict)


class EvidenceGatewayManifest(StrictModel):
    contract_version: Literal["sozorock.evidence-gateway.v1"] = SHARED_EVIDENCE_CONTRACT_VERSION
    release_id: str = Field(min_length=1)
    generated_at: datetime
    evidence_core_schema_version: str = Field(min_length=1)
    release_hash: str = Field(min_length=16)
    source_versions: list[SourceVersionRef] = Field(default_factory=list)


class EvidenceGatewayQuery(StrictModel):
    geography_ids: list[str] = Field(min_length=1)
    measure_ids: list[str] = Field(default_factory=list)
    include_relationships: bool = True
    include_lineage: bool = True


class PublicEvidencePackage(StrictModel):
    """Only data approved for the shared public evidence boundary may appear here.

    Unknown fields fail closed, so tenant IDs, private planning notes, funding fit,
    review notes and organization memory cannot cross this envelope accidentally.
    """

    contract_version: Literal["sozorock.evidence-gateway.v1"] = SHARED_EVIDENCE_CONTRACT_VERSION
    release_id: str = Field(min_length=1)
    generated_at: datetime
    geographies: list[GeographyRef] = Field(default_factory=list)
    geography_relationships: list[GeographyRelationshipRef] = Field(default_factory=list)
    metric_semantics: list[MetricSemantics] = Field(default_factory=list)
    measures: list[PublicEvidenceMeasure] = Field(default_factory=list)
    source_versions: list[SourceVersionRef] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_referenced_geographies(self) -> "PublicEvidencePackage":
        geography_ids = {geography.id for geography in self.geographies}
        missing = {
            measure.geography.id
            for measure in self.measures
            if measure.geography.id not in geography_ids
        }
        if missing:
            raise ValueError(
                "measures reference geographies not included in package: "
                + ", ".join(sorted(missing))
            )
        return self


class EvidenceGatewayResponse(StrictModel):
    manifest: EvidenceGatewayManifest
    package: PublicEvidencePackage

    @model_validator(mode="after")
    def versions_and_release_ids_must_match(self) -> "EvidenceGatewayResponse":
        if self.manifest.contract_version != self.package.contract_version:
            raise ValueError("manifest/package contract versions do not match")
        if self.manifest.release_id != self.package.release_id:
            raise ValueError("manifest/package release IDs do not match")
        return self


PUBLIC_EVIDENCE_CORE_COMPATIBILITY = {
    "Geography": "GeographyRef",
    "GeographyRelationship": "GeographyRelationshipRef",
    "SourceVersion": "SourceVersionRef",
    "MeasureDefinition": "MetricSemantics",
    "MetricObservation": "PublicEvidenceMeasure",
}


def assert_public_package(payload: dict) -> PublicEvidencePackage:
    """Validate a gateway payload and fail closed on private or unknown fields."""

    return PublicEvidencePackage.model_validate(payload)
