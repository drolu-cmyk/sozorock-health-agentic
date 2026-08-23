from __future__ import annotations

from itertools import combinations
from typing import Literal

from pydantic import Field

from .models import (
    BarrierFamily,
    BarrierObservation,
    Measure,
    ReviewStatus,
    StrictModel,
)


class BarrierDefinition(StrictModel):
    family: BarrierFamily
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)
    planning_questions: list[str] = Field(min_length=1)


BARRIER_DEFINITIONS: tuple[BarrierDefinition, ...] = (
    BarrierDefinition(
        family=BarrierFamily.CARE_AVAILABILITY,
        label="Care availability",
        description="Whether relevant services and licensed providers are available within a usable service area.",
        planning_questions=["Where does service availability appear thin relative to documented need?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.WORKFORCE,
        label="Workforce capacity",
        description="Provider and public-health workforce capacity, including verified shortage and designation context.",
        planning_questions=["Where do workforce constraints overlap with other access pressures?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.AFFORDABILITY_INSURANCE,
        label="Affordability and insurance",
        description="Financial access pressures such as coverage gaps or cost-related difficulty obtaining care.",
        planning_questions=["Where are affordability pressures elevated relative to appropriate peers?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.TRANSPORTATION_TRAVEL,
        label="Transportation and travel",
        description="Reliable transportation, vehicle access, transit, distance and travel-time constraints relevant to access planning.",
        planning_questions=["Which places face mobility constraints that may make existing services difficult to reach?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.FOOD_SECURITY,
        label="Food security",
        description="Evidence of unreliable access to sufficient food and related local resource context.",
        planning_questions=["Where does food insecurity coexist with other documented community pressures?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.HOUSING,
        label="Housing",
        description="Housing insecurity, affordability, quality or instability when supported by verified evidence.",
        planning_questions=["Where are housing pressures concentrated and reflected in local planning documents?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.UTILITIES,
        label="Utilities",
        description="Utility insecurity or energy burden that may affect household stability and access planning.",
        planning_questions=["Where do utility pressures add to other household access constraints?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.DIGITAL_ACCESS,
        label="Digital access",
        description="Broadband, internet subscription, device or digital-access limitations relevant to service access.",
        planning_questions=["Where could digital access limit use of otherwise available services?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.LANGUAGE_INFORMATION,
        label="Language and information access",
        description="Language, communication and information-access conditions that may affect the usability of services.",
        planning_questions=["Where should planning account for language or communication access?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.BUILT_ENVIRONMENT,
        label="Built environment",
        description="Place conditions such as walkability, service distribution or physical access when supported by appropriate data.",
        planning_questions=["How does the local environment shape practical access to services and resources?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.SOCIAL_CONNECTION,
        label="Social connection",
        description="Social support and isolation conditions relevant to community planning.",
        planning_questions=["Where is weak social connection documented alongside other community needs?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.ENVIRONMENTAL_CONTEXT,
        label="Environmental context",
        description="Environmental conditions that are relevant to planning and supported by an appropriate authoritative source.",
        planning_questions=["Which environmental conditions should be considered in the planning context?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.PREVENTIVE_SERVICE_GAPS,
        label="Preventive-service gaps",
        description="Gaps in use of appropriate preventive services at the population level, without individual clinical inference.",
        planning_questions=["Where do population-level preventive-service gaps warrant planning attention?"],
    ),
    BarrierDefinition(
        family=BarrierFamily.PUBLIC_HEALTH_CAPACITY,
        label="Public-health capacity",
        description="Organizational, workforce and implementation capacity affecting the ability to carry out community plans.",
        planning_questions=["Which priorities may be constrained by implementation capacity rather than lack of evidence?"],
    ),
)


BarrierClassification = Literal["barrier", "context", "service_gap", "capacity"]
BarrierAdmissionStatus = Literal["admitted", "context_only", "rejected"]


class BarrierMeasureRule(StrictModel):
    id: str = Field(min_length=1)
    source_measure_ids: list[str] = Field(min_length=1)
    classification: BarrierClassification
    barrier_family: BarrierFamily | None = None
    required_direction: Literal["adverse", "protective", "contextual", "unknown"] | None = None
    required_comparison_policy: Literal[
        "higher_is_concern",
        "lower_is_concern",
        "context_only",
        "not_rankable",
    ] | None = None
    rationale: str = Field(min_length=1)


class BarrierAdmissionDecision(StrictModel):
    measure_id: str = Field(min_length=1)
    rule_id: str | None = None
    status: BarrierAdmissionStatus
    reason_codes: list[str] = Field(default_factory=list)
    observation: BarrierObservation | None = None


class BarrierClassificationResult(StrictModel):
    decisions: list[BarrierAdmissionDecision] = Field(default_factory=list)
    observations: list[BarrierObservation] = Field(default_factory=list)


INITIAL_BARRIER_RULES: tuple[BarrierMeasureRule, ...] = (
    BarrierMeasureRule(
        id="barrier:affordability:uninsured",
        source_measure_ids=["UNINSURED", "uninsured"],
        classification="barrier",
        barrier_family=BarrierFamily.AFFORDABILITY_INSURANCE,
        required_direction="adverse",
        required_comparison_policy="higher_is_concern",
        rationale="Lack of current health insurance can constrain affordable access to care.",
    ),
    BarrierMeasureRule(
        id="barrier:transportation:lack-reliable-transport",
        source_measure_ids=["LACKTRPT", "transportation"],
        classification="barrier",
        barrier_family=BarrierFamily.TRANSPORTATION_TRAVEL,
        required_direction="adverse",
        required_comparison_policy="higher_is_concern",
        rationale="Lack of reliable transportation can constrain physical access to services.",
    ),
    BarrierMeasureRule(
        id="barrier:food:food-insecurity",
        source_measure_ids=["FOODINSECU", "foodInsecurity", "food_insecurity"],
        classification="barrier",
        barrier_family=BarrierFamily.FOOD_SECURITY,
        required_direction="adverse",
        required_comparison_policy="higher_is_concern",
        rationale="Food insecurity is an adverse household resource condition relevant to community planning.",
    ),
    BarrierMeasureRule(
        id="barrier:housing:housing-insecurity",
        source_measure_ids=["HOUSINSECU", "housingInsecurity", "housing_insecurity"],
        classification="barrier",
        barrier_family=BarrierFamily.HOUSING,
        required_direction="adverse",
        required_comparison_policy="higher_is_concern",
        rationale="Housing insecurity is an adverse stability condition relevant to access and implementation planning.",
    ),
    BarrierMeasureRule(
        id="barrier:utilities:shutoff-threat",
        source_measure_ids=["SHUTUTILITY", "utilityShutoff", "utility_shutoff"],
        classification="barrier",
        barrier_family=BarrierFamily.UTILITIES,
        required_direction="adverse",
        required_comparison_policy="higher_is_concern",
        rationale="Utility shutoff or threat indicates household resource pressure relevant to planning.",
    ),
    BarrierMeasureRule(
        id="barrier:social:loneliness",
        source_measure_ids=["LONELINESS", "loneliness"],
        classification="barrier",
        barrier_family=BarrierFamily.SOCIAL_CONNECTION,
        required_direction="adverse",
        required_comparison_policy="higher_is_concern",
        rationale="Loneliness is an adverse social-connection condition relevant to community planning.",
    ),
    BarrierMeasureRule(
        id="context:accessibility:disability",
        source_measure_ids=["DISABILITY", "disability"],
        classification="context",
        barrier_family=None,
        rationale="Disability informs accommodation and accessibility planning and must not itself be labeled a barrier.",
    ),
)


def _normalized(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())


def find_barrier_rule(
    measure: Measure,
    rules: tuple[BarrierMeasureRule, ...] = INITIAL_BARRIER_RULES,
) -> BarrierMeasureRule | None:
    candidates = {
        _normalized(measure.semantics.source_measure_id),
        _normalized(measure.semantics.id),
    }
    matches = [
        rule
        for rule in rules
        if candidates.intersection({_normalized(item) for item in rule.source_measure_ids})
    ]
    if len(matches) > 1:
        raise ValueError(
            f"measure {measure.id} matches multiple barrier ontology rules: "
            + ", ".join(item.id for item in matches)
        )
    return matches[0] if matches else None


def classify_barrier_measure(
    measure: Measure,
    *,
    rules: tuple[BarrierMeasureRule, ...] = INITIAL_BARRIER_RULES,
) -> BarrierAdmissionDecision:
    rule = find_barrier_rule(measure, rules)
    if rule is None:
        return BarrierAdmissionDecision(
            measure_id=measure.id,
            status="rejected",
            reason_codes=["measure_not_in_barrier_ontology"],
        )

    if rule.classification == "context":
        return BarrierAdmissionDecision(
            measure_id=measure.id,
            rule_id=rule.id,
            status="context_only",
            reason_codes=["context_not_barrier"],
        )

    reasons: list[str] = []
    if measure.review_status != ReviewStatus.VERIFIED:
        reasons.append("measure_not_verified")
    if measure.semantics.review_status != ReviewStatus.VERIFIED:
        reasons.append("metric_semantics_not_verified")
    if rule.required_direction and measure.semantics.direction != rule.required_direction:
        reasons.append("metric_direction_mismatch")
    if (
        rule.required_comparison_policy
        and measure.semantics.comparison_policy != rule.required_comparison_policy
    ):
        reasons.append("comparison_policy_mismatch")
    if (
        measure.semantics.allowed_geography_kinds
        and measure.geography.kind not in measure.semantics.allowed_geography_kinds
    ):
        reasons.append("geography_not_allowed_for_metric")
    if measure.numeric_value is None:
        reasons.append("numeric_value_required")
    if rule.barrier_family is None:
        reasons.append("barrier_family_missing")

    if reasons:
        return BarrierAdmissionDecision(
            measure_id=measure.id,
            rule_id=rule.id,
            status="rejected",
            reason_codes=sorted(set(reasons)),
        )

    observation = BarrierObservation(
        id=f"barrier-observation:{rule.id}:{measure.geography.id}:{measure.id}",
        barrier_family=rule.barrier_family,
        geography=measure.geography,
        measure_id=measure.id,
        observed_value=measure.numeric_value,
        pressure_percentile=None,
        concentration=None,
        trend_direction="insufficient_evidence",
        evidence_quality="high",
        review_status=ReviewStatus.VERIFIED,
    )
    return BarrierAdmissionDecision(
        measure_id=measure.id,
        rule_id=rule.id,
        status="admitted",
        observation=observation,
    )


def classify_barrier_measures(
    measures: list[Measure],
    *,
    rules: tuple[BarrierMeasureRule, ...] = INITIAL_BARRIER_RULES,
) -> BarrierClassificationResult:
    decisions = [classify_barrier_measure(item, rules=rules) for item in measures]
    observations = [
        item.observation
        for item in decisions
        if item.status == "admitted" and item.observation is not None
    ]
    return BarrierClassificationResult(decisions=decisions, observations=observations)


class BarrierCooccurrence(StrictModel):
    geography_id: str = Field(min_length=1)
    observation_ids: list[str] = Field(min_length=2, max_length=2)
    family_ids: list[BarrierFamily] = Field(min_length=2, max_length=2)
    basis: str = "Both verified observations exceed the explicit planning-attention threshold in the same geography. This is co-occurrence, not causation."


class BarrierIntelligenceSummary(StrictModel):
    geography_id: str = Field(min_length=1)
    attention_threshold: float = Field(ge=0, le=100)
    verified_observations: list[BarrierObservation] = Field(default_factory=list)
    attention_observations: list[BarrierObservation] = Field(default_factory=list)
    insufficient_observations: list[BarrierObservation] = Field(default_factory=list)
    cooccurrences: list[BarrierCooccurrence] = Field(default_factory=list)


def summarize_barriers(
    observations: list[BarrierObservation],
    geography_id: str,
    *,
    attention_threshold: float = 75.0,
) -> BarrierIntelligenceSummary:
    """Summarize barrier evidence without producing an opaque composite score."""

    relevant = [item for item in observations if item.geography.id == geography_id]
    verified = [item for item in relevant if item.review_status == ReviewStatus.VERIFIED]
    attention = sorted(
        [
            item
            for item in verified
            if item.pressure_percentile is not None
            and item.pressure_percentile >= attention_threshold
        ],
        key=lambda item: item.pressure_percentile or 0,
        reverse=True,
    )
    insufficient = [
        item
        for item in relevant
        if item.review_status != ReviewStatus.VERIFIED
        or item.pressure_percentile is None
        or item.evidence_quality == "insufficient"
    ]

    cooccurrences = [
        BarrierCooccurrence(
            geography_id=geography_id,
            observation_ids=[left.id, right.id],
            family_ids=[left.barrier_family, right.barrier_family],
        )
        for left, right in combinations(attention, 2)
        if left.barrier_family != right.barrier_family
    ]

    return BarrierIntelligenceSummary(
        geography_id=geography_id,
        attention_threshold=attention_threshold,
        verified_observations=verified,
        attention_observations=attention,
        insufficient_observations=insufficient,
        cooccurrences=cooccurrences,
    )
