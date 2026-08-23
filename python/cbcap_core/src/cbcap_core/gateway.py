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
SourceCoverageStatus = Literal[
    "complete_with_records",
    "complete_no_records",
    "partial",
    "unavailable",
    "stale",
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


class SourceCoverageAssertion(StrictModel):
    """Verified evidence about whether a source query completed for one geography.

    This is retrieval coverage, not a health or planning finding. A complete
    zero-record assertion may support a negative source result only when the
    specialist knows which coverage keys are required.
    """

    id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    source_version_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    coverage_key: str = Field(min_length=1)
    status: SourceCoverageStatus
    records_matched: int = Field(ge=0)
    evaluated_at: datetime
    review_status: ReviewStatus
    caveat: str | None = None

    @model_validator(mode="after")
    def validate_record_status(self) -> "SourceCoverageAssertion":
        if self.status == "complete_with_records" and self.records_matched == 0:
            raise ValueError("complete_with_records requires records_matched > 0")
        if self.status == "complete_no_records" and self.records_matched != 0:
            raise ValueError("complete_no_records requires records_matched == 0")
        return self


class PublicEvidenceMeasure(Measure):
    """Public measure using the canonical observation-scope contract.

    Scope and source metadata live on `Measure` so all private CB-CAP consumers
    preserve the same public Evidence Gateway semantics. A specialist must still
    fail closed when those optional v1 fields are absent.
    """


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
    source_coverage: list[SourceCoverageAssertion] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_references(self) -> "PublicEvidencePackage":
        geography_ids = {geography.id for geography in self.geographies}
        missing_geographies = {
            measure.geography.id
            for measure in self.measures
            if measure.geography.id not in geography_ids
        }
        if missing_geographies:
            raise ValueError(
                "measures reference geographies not included in package: "
                + ", ".join(sorted(missing_geographies))
            )

        source_versions = {item.source_version_id: item for item in self.source_versions}
        coverage_ids: set[str] = set()
        for assertion in self.source_coverage:
            if assertion.id in coverage_ids:
                raise ValueError(f"duplicate source coverage id: {assertion.id}")
            coverage_ids.add(assertion.id)
            if assertion.geography_id not in geography_ids:
                raise ValueError(
                    f"source coverage {assertion.id} references missing geography {assertion.geography_id}"
                )
            source_version = source_versions.get(assertion.source_version_id)
            if source_version is None:
                raise ValueError(
                    f"source coverage {assertion.id} references missing source version {assertion.source_version_id}"
                )
            if source_version.source_id != assertion.source_id:
                raise ValueError(
                    f"source coverage {assertion.id} source_id does not match its source version"
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
    "SourceCoverageAssertion": "SourceCoverageAssertion",
}


def assert_public_package(payload: dict) -> PublicEvidencePackage:
    """Validate a gateway payload and fail closed on private or unknown fields."""

    return PublicEvidencePackage.model_validate(payload)
