from __future__ import annotations

from itertools import combinations

from pydantic import Field

from .models import BarrierFamily, BarrierObservation, ReviewStatus, StrictModel


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
