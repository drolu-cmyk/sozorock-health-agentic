from __future__ import annotations

from typing import Literal

from pydantic import Field

from .gateway import PublicEvidenceMeasure
from .models import ReviewStatus, StrictModel


WorkforceCapacityKind = Literal[
    "population_context",
    "primary_care_physicians",
    "dentists",
    "rural_health_clinics",
    "short_term_general_hospitals",
    "nhsc_primary_care_sites",
    "nhsc_primary_care_provider_fte",
]
CapacityAdmissionStatus = Literal["admitted", "rejected"]


class AhrfCapacityRule(StrictModel):
    source_measure_id: str = Field(min_length=1)
    kind: WorkforceCapacityKind
    label: str = Field(min_length=1)
    reference_year: int = Field(ge=2000, le=2100)
    display_unit: str = Field(min_length=1)


AHRF_CAPACITY_RULES: tuple[AhrfCapacityRule, ...] = (
    AhrfCapacityRule(
        source_measure_id="popn_est_23",
        kind="population_context",
        label="Estimated population",
        reference_year=2023,
        display_unit="people",
    ),
    AhrfCapacityRule(
        source_measure_id="phys_nf_prim_care_pc_exc_rsdt_23",
        kind="primary_care_physicians",
        label="Nonfederal primary care physicians, excluding residents",
        reference_year=2023,
        display_unit="professionals",
    ),
    AhrfCapacityRule(
        source_measure_id="dent_nf_fed_proflly_activ_23",
        kind="dentists",
        label="Professionally active dentists",
        reference_year=2023,
        display_unit="professionals",
    ),
    AhrfCapacityRule(
        source_measure_id="rural_hlth_clincs_23",
        kind="rural_health_clinics",
        label="Rural health clinics",
        reference_year=2023,
        display_unit="facilities",
    ),
    AhrfCapacityRule(
        source_measure_id="stgh_23",
        kind="short_term_general_hospitals",
        label="Short-term general hospitals",
        reference_year=2023,
        display_unit="facilities",
    ),
    AhrfCapacityRule(
        source_measure_id="nhsc_prim_care_sites_24",
        kind="nhsc_primary_care_sites",
        label="National Health Service Corps primary care sites",
        reference_year=2024,
        display_unit="sites",
    ),
    AhrfCapacityRule(
        source_measure_id="nhsc_fte_prim_care_provdrs_24",
        kind="nhsc_primary_care_provider_fte",
        label="National Health Service Corps primary care provider FTEs",
        reference_year=2024,
        display_unit="full-time equivalents",
    ),
)


class WorkforceCapacityObservation(StrictModel):
    id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    kind: WorkforceCapacityKind
    label: str = Field(min_length=1)
    value: float
    display_unit: str = Field(min_length=1)
    reference_year: int = Field(ge=2000, le=2100)
    source_measure_id: str = Field(min_length=1)
    source_version_id: str = Field(min_length=1)
    source_observation_id: str = Field(min_length=1)
    review_status: ReviewStatus
    interpretation_boundary: str = (
        "Contextual county capacity evidence only. It does not by itself establish shortage, appointment availability, quality, causation, or a recommended response."
    )


class CapacityAdmissionDecision(StrictModel):
    measure_id: str = Field(min_length=1)
    status: CapacityAdmissionStatus
    reason_codes: list[str] = Field(default_factory=list)
    observation: WorkforceCapacityObservation | None = None


class WorkforceCapacityResult(StrictModel):
    decisions: list[CapacityAdmissionDecision] = Field(default_factory=list)
    observations: list[WorkforceCapacityObservation] = Field(default_factory=list)


def find_ahrf_rule(source_measure_id: str) -> AhrfCapacityRule | None:
    normalized = source_measure_id.strip().lower()
    matches = [item for item in AHRF_CAPACITY_RULES if item.source_measure_id == normalized]
    if len(matches) > 1:
        raise ValueError(f"AHRF source measure {source_measure_id} matches multiple capacity rules")
    return matches[0] if matches else None


def _encoded_reference_year(measure: PublicEvidenceMeasure) -> int | None:
    metadata_year = measure.source_metadata.get("variableYear")
    if metadata_year is not None:
        try:
            return int(str(metadata_year))
        except ValueError:
            return None
    periods = [measure.data_period_start, measure.data_period_end]
    years = {item.year for item in periods if item is not None}
    if len(years) == 1:
        return next(iter(years))
    return None


def classify_ahrf_capacity_measure(measure: PublicEvidenceMeasure) -> CapacityAdmissionDecision:
    rule = find_ahrf_rule(measure.semantics.source_measure_id)
    if rule is None:
        return CapacityAdmissionDecision(
            measure_id=measure.id,
            status="rejected",
            reason_codes=["ahrf_variable_not_approved"],
        )

    reasons: list[str] = []
    if measure.source_version.source_id != "ahrf-workforce":
        reasons.append("not_ahrf_workforce_source")
    if measure.review_status != ReviewStatus.VERIFIED:
        reasons.append("observation_not_verified")
    if measure.source_version.review_status != ReviewStatus.VERIFIED:
        reasons.append("source_version_not_verified")
    if measure.semantics.review_status != ReviewStatus.VERIFIED:
        reasons.append("metric_semantics_not_verified")
    if measure.geography_level != "county":
        reasons.append("ahrf_capacity_requires_county_scope")
    if measure.semantics.direction != "contextual":
        reasons.append("ahrf_capacity_must_be_contextual")
    if measure.semantics.comparison_policy != "context_only":
        reasons.append("ahrf_capacity_must_be_context_only")
    if measure.numeric_value is None:
        reasons.append("numeric_value_required")

    encoded_year = _encoded_reference_year(measure)
    if encoded_year is None:
        reasons.append("ahrf_variable_year_missing")
    elif encoded_year != rule.reference_year:
        reasons.append("ahrf_variable_year_mismatch")

    if reasons:
        return CapacityAdmissionDecision(
            measure_id=measure.id,
            status="rejected",
            reason_codes=sorted(set(reasons)),
        )

    observation = WorkforceCapacityObservation(
        id=f"workforce-capacity:{measure.geography.id}:{measure.id}",
        geography_id=measure.geography.id,
        kind=rule.kind,
        label=rule.label,
        value=measure.numeric_value,
        display_unit=rule.display_unit,
        reference_year=rule.reference_year,
        source_measure_id=rule.source_measure_id,
        source_version_id=measure.source_version.source_version_id,
        source_observation_id=measure.id,
        review_status=ReviewStatus.VERIFIED,
    )
    return CapacityAdmissionDecision(
        measure_id=measure.id,
        status="admitted",
        observation=observation,
    )


def classify_ahrf_capacity_measures(
    measures: list[PublicEvidenceMeasure],
) -> WorkforceCapacityResult:
    decisions = [
        classify_ahrf_capacity_measure(item)
        for item in measures
        if item.source_version.source_id == "ahrf-workforce"
    ]
    observations = [
        item.observation
        for item in decisions
        if item.status == "admitted" and item.observation is not None
    ]
    return WorkforceCapacityResult(decisions=decisions, observations=observations)
