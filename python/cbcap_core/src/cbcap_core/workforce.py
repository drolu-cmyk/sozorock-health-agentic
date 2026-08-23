from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field

from .gateway import PublicEvidenceMeasure
from .models import ReviewStatus, StrictModel


WorkforceDiscipline = Literal["primary_care", "dental", "mental_health", "unknown"]
DesignationScope = Literal["county", "population_group", "facility", "source_designation"]
WorkforceAdmissionStatus = Literal["admitted", "rejected"]


class WorkforceDesignation(StrictModel):
    id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    scope: DesignationScope
    discipline: WorkforceDiscipline
    designation_name: str = Field(min_length=1)
    designation_type: str = Field(min_length=1)
    component_type: str = Field(min_length=1)
    status: str = Field(min_length=1)
    score: float | None = None
    designation_date: date | None = None
    last_update_date: date | None = None
    source_measure_id: str = Field(min_length=1)
    source_version_id: str = Field(min_length=1)
    source_observation_id: str = Field(min_length=1)
    review_status: ReviewStatus

    @property
    def is_whole_county(self) -> bool:
        return self.scope == "county"


class WorkforceAdmissionDecision(StrictModel):
    measure_id: str = Field(min_length=1)
    status: WorkforceAdmissionStatus
    reason_codes: list[str] = Field(default_factory=list)
    designation: WorkforceDesignation | None = None


class WorkforceClassificationResult(StrictModel):
    decisions: list[WorkforceAdmissionDecision] = Field(default_factory=list)
    designations: list[WorkforceDesignation] = Field(default_factory=list)


def _metadata_text(measure: PublicEvidenceMeasure, key: str) -> str:
    value = measure.source_metadata.get(key)
    return str(value).strip() if value is not None else ""


def _metadata_date(measure: PublicEvidenceMeasure, key: str) -> date | None:
    raw = _metadata_text(measure, key)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _discipline(value: str) -> WorkforceDiscipline:
    normalized = value.lower()
    if "primary" in normalized:
        return "primary_care"
    if "dental" in normalized:
        return "dental"
    if "mental" in normalized:
        return "mental_health"
    return "unknown"


def classify_workforce_measure(measure: PublicEvidenceMeasure) -> WorkforceAdmissionDecision:
    reasons: list[str] = []
    if measure.source_version.source_id != "hrsa-workforce":
        reasons.append("not_hrsa_workforce_source")
    if measure.semantics.source_measure_id != "HPSA_DESIGNATION":
        reasons.append("not_hpsa_designation_measure")
    if measure.review_status != ReviewStatus.VERIFIED:
        reasons.append("observation_not_verified")
    if measure.source_version.review_status != ReviewStatus.VERIFIED:
        reasons.append("source_version_not_verified")
    if measure.geography_level is None:
        reasons.append("observation_scope_missing")
    elif measure.geography_level not in {
        "county",
        "population_group",
        "facility",
        "source_designation",
    }:
        reasons.append("unsupported_designation_scope")

    designation_name = _metadata_text(measure, "designationName")
    designation_type = _metadata_text(measure, "designationType")
    component_type = _metadata_text(measure, "componentType")
    discipline_raw = _metadata_text(measure, "discipline")
    status = _metadata_text(measure, "designationStatus")
    whole_county_flag = measure.source_metadata.get("wholeCountyGeographicDesignation")

    if not designation_name:
        reasons.append("designation_name_missing")
    if not designation_type:
        reasons.append("designation_type_missing")
    if not component_type:
        reasons.append("component_type_missing")
    if not status:
        reasons.append("designation_status_missing")

    if measure.geography_level == "county" and whole_county_flag is not True:
        reasons.append("county_scope_not_confirmed_by_source")
    if measure.geography_level != "county" and whole_county_flag is True:
        reasons.append("scope_metadata_conflict")

    if reasons:
        return WorkforceAdmissionDecision(
            measure_id=measure.id,
            status="rejected",
            reason_codes=sorted(set(reasons)),
        )

    score = measure.numeric_value
    designation = WorkforceDesignation(
        id=f"workforce-designation:{measure.id}",
        geography_id=measure.geography.id,
        scope=measure.geography_level,
        discipline=_discipline(discipline_raw),
        designation_name=designation_name,
        designation_type=designation_type,
        component_type=component_type,
        status=status,
        score=score,
        designation_date=measure.data_period_start,
        last_update_date=_metadata_date(measure, "lastUpdateDate"),
        source_measure_id=measure.semantics.source_measure_id,
        source_version_id=measure.source_version.source_version_id,
        source_observation_id=measure.id,
        review_status=measure.review_status,
    )
    return WorkforceAdmissionDecision(
        measure_id=measure.id,
        status="admitted",
        designation=designation,
    )


def classify_workforce_measures(
    measures: list[PublicEvidenceMeasure],
) -> WorkforceClassificationResult:
    decisions = [
        classify_workforce_measure(item)
        for item in measures
        if item.source_version.source_id == "hrsa-workforce"
    ]
    designations = [
        item.designation
        for item in decisions
        if item.status == "admitted" and item.designation is not None
    ]
    return WorkforceClassificationResult(
        decisions=decisions,
        designations=designations,
    )
