from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    """Default contract behavior: reject unknown fields and validate assignments."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        validate_assignment=True,
        use_enum_values=False,
    )


class ReviewStatus(StrEnum):
    VERIFIED = "verified"
    PROVISIONAL = "provisional"
    STALE = "stale"
    UNAVAILABLE = "unavailable"
    REJECTED = "rejected"


class GeographyKind(StrEnum):
    STATE = "state"
    COUNTY = "county"
    CENSUS_PLACE = "census_place"
    ZCTA = "zcta"
    POSTAL_ZIP = "postal_zip"
    PLANNING_REGION = "planning_region"
    CENSUS_TRACT = "census_tract"
    COUNTY_SUBDIVISION = "county_subdivision"


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


class Confidence(StrEnum):
    HIGH = "high"
    MODERATE = "moderate"
    LOW = "low"


class ExtractionMethod(StrEnum):
    HUMAN = "human"
    OCR = "ocr"
    STRUCTURED_PARSER = "structured_parser"
    MODEL_ASSISTED = "model_assisted"


class TenantVisibility(StrEnum):
    PUBLIC = "public"
    TENANT = "tenant"
    RESTRICTED = "restricted"
    INTERNAL = "internal"


class DocumentTrust(StrEnum):
    OFFICIAL_VERIFIED = "official_verified"
    UNTRUSTED_EXTERNAL = "untrusted_external"
    TENANT_PRIVATE = "tenant_private"


class BarrierFamily(StrEnum):
    CARE_AVAILABILITY = "care_availability"
    WORKFORCE = "workforce"
    AFFORDABILITY_INSURANCE = "affordability_insurance"
    TRANSPORTATION_TRAVEL = "transportation_travel"
    FOOD_SECURITY = "food_security"
    HOUSING = "housing"
    UTILITIES = "utilities"
    DIGITAL_ACCESS = "digital_access"
    LANGUAGE_INFORMATION = "language_information"
    BUILT_ENVIRONMENT = "built_environment"
    SOCIAL_CONNECTION = "social_connection"
    ENVIRONMENTAL_CONTEXT = "environmental_context"
    PREVENTIVE_SERVICE_GAPS = "preventive_service_gaps"
    PUBLIC_HEALTH_CAPACITY = "public_health_capacity"


class RunStatus(StrEnum):
    CREATED = "created"
    RUNNING = "running"
    WAITING_REVIEW = "waiting_review"
    BLOCKED = "blocked"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class AgentRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"


class GeographyRef(StrictModel):
    """Stable geography contract mirrored from the public Evidence Core."""

    id: str = Field(min_length=1)
    kind: GeographyKind
    authority: Literal["census", "usps", "state", "local", "regional"]
    authority_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    state_fips: str | None = Field(default=None, pattern=r"^\d{2}$")
    county_fips: str | None = Field(default=None, pattern=r"^\d{5}$")
    vintage: str = Field(min_length=1)
    valid_from: date | None = None
    valid_to: date | None = None
    review_status: ReviewStatus
    caveat: str | None = None

    @model_validator(mode="after")
    def validate_county_identity(self) -> "GeographyRef":
        if self.kind == GeographyKind.COUNTY and self.county_fips is None:
            raise ValueError("county geography requires county_fips")
        if self.county_fips and self.state_fips and not self.county_fips.startswith(self.state_fips):
            raise ValueError("county_fips must begin with state_fips")
        return self


class SourceVersionRef(StrictModel):
    """Public source identity and lineage; no tenant-private fields are allowed."""

    source_id: str = Field(min_length=1)
    source_version_id: str = Field(min_length=1)
    publisher: str = Field(min_length=1)
    title: str = Field(min_length=1)
    official_url: str = Field(min_length=1)
    release_label: str = Field(min_length=1)
    release_date: date
    data_period_start: date | None = None
    data_period_end: date | None = None
    retrieved_at: datetime
    stale_after: datetime | None = None
    content_hash: str = Field(min_length=16)
    schema_version: str = Field(min_length=1)
    review_status: ReviewStatus


class MetricSemantics(StrictModel):
    """Rules that control comparison, trend, forecast and visualization behavior."""

    id: str = Field(min_length=1)
    source_measure_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    direction: Literal["adverse", "protective", "contextual", "unknown"]
    higher_value_meaning: Literal["favorable", "adverse", "neutral", "context_dependent"]
    unit: Literal["percent", "count", "rate", "ratio", "index", "designation", "people", "coverage", "percentile"]
    universe: str = Field(min_length=1)
    adjustment: Literal["crude", "age_adjusted", "modeled", "not_applicable"]
    comparison_policy: Literal["higher_is_concern", "lower_is_concern", "context_only", "not_rankable"]
    trendable: bool = False
    forecastable: bool = False
    aggregatable: bool = False
    allowed_geography_kinds: list[GeographyKind] = Field(default_factory=list)
    allowed_visualizations: list[str] = Field(default_factory=list)
    review_status: ReviewStatus


class SourceDocument(StrictModel):
    id: str = Field(min_length=1)
    source_version: SourceVersionRef
    document_type: Literal[
        "cha",
        "chip",
        "chna",
        "csp",
        "implementation_strategy",
        "supporting_report",
        "funding_notice",
        "guidance",
        "dataset_documentation",
        "other",
    ]
    geography_ids: list[str] = Field(default_factory=list)
    content_hash: str = Field(min_length=16)
    content_locator: str = Field(min_length=1)
    page_count: int | None = Field(default=None, ge=1)
    trust: DocumentTrust = DocumentTrust.UNTRUSTED_EXTERNAL
    visibility: TenantVisibility = TenantVisibility.PUBLIC
    tenant_id: str | None = None
    review_status: ReviewStatus

    @model_validator(mode="after")
    def tenant_visibility_requires_tenant(self) -> "SourceDocument":
        if self.visibility in {TenantVisibility.TENANT, TenantVisibility.RESTRICTED} and not self.tenant_id:
            raise ValueError("tenant or restricted documents require tenant_id")
        if self.visibility == TenantVisibility.PUBLIC and self.tenant_id is not None:
            raise ValueError("public documents cannot carry tenant_id")
        return self


class CitationLocator(StrictModel):
    page_number: int | None = Field(default=None, ge=1)
    section: str | None = None
    paragraph: str | None = None
    source_field: str | None = None
    quoted_text_hash: str | None = None


class EvidenceClaim(StrictModel):
    id: str = Field(min_length=1)
    source_document_id: str = Field(min_length=1)
    geography_ids: list[str] = Field(min_length=1)
    claim_type: Literal[
        "priority",
        "finding",
        "disparity",
        "barrier",
        "objective",
        "intervention",
        "responsible_partner",
        "target_population",
        "evaluation_measure",
        "asset",
        "action",
        "data_gap",
        "eligibility",
        "funding_requirement",
    ]
    statement: str = Field(min_length=1)
    citation: CitationLocator
    extraction_method: ExtractionMethod
    confidence: Confidence
    review_status: ReviewStatus
    visibility: TenantVisibility = TenantVisibility.PUBLIC
    tenant_id: str | None = None

    @model_validator(mode="after")
    def validate_visibility(self) -> "EvidenceClaim":
        if self.visibility in {TenantVisibility.TENANT, TenantVisibility.RESTRICTED} and not self.tenant_id:
            raise ValueError("tenant or restricted claims require tenant_id")
        if self.visibility == TenantVisibility.PUBLIC and self.tenant_id is not None:
            raise ValueError("public claims cannot carry tenant_id")
        return self


class Measure(StrictModel):
    id: str = Field(min_length=1)
    semantics: MetricSemantics
    geography: GeographyRef
    source_version: SourceVersionRef
    geography_level: ObservationGeographyLevel | None = None
    value: float | int | str | bool | None
    numeric_value: float | None = None
    confidence_low: float | None = None
    confidence_high: float | None = None
    margin_of_error: float | None = None
    data_period_start: date | None = None
    data_period_end: date | None = None
    source_metadata: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    review_status: ReviewStatus


class BarrierObservation(StrictModel):
    id: str = Field(min_length=1)
    barrier_family: BarrierFamily
    geography: GeographyRef
    measure_id: str = Field(min_length=1)
    evidence_claim_ids: list[str] = Field(default_factory=list)
    observed_value: float | None = None
    pressure_percentile: float | None = Field(default=None, ge=0, le=100)
    concentration: float | None = Field(default=None, ge=0, le=1)
    trend_direction: Literal["improving", "worsening", "stable", "insufficient_evidence"] = "insufficient_evidence"
    evidence_quality: Literal["high", "moderate", "low", "insufficient"] = "insufficient"
    review_status: ReviewStatus


class BarrierPattern(StrictModel):
    id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    observation_ids: list[str] = Field(min_length=2)
    label: str = Field(min_length=1)
    explanation: str = Field(min_length=1)
    method_version: str = Field(min_length=1)
    confidence: Confidence
    review_status: ReviewStatus


class PlanDocument(StrictModel):
    id: str = Field(min_length=1)
    source_document_id: str = Field(min_length=1)
    document_type: Literal["cha", "chip", "chna", "csp", "implementation_strategy", "supporting_report"]
    title: str = Field(min_length=1)
    publisher: str = Field(min_length=1)
    geography_ids: list[str] = Field(min_length=1)
    published_at: date | None = None
    period_start: date | None = None
    period_end: date | None = None
    current_plan_status: Literal["verified_current", "not_yet_verified", "superseded", "not_applicable"]
    review_status: ReviewStatus


class PlanPriority(StrictModel):
    id: str = Field(min_length=1)
    plan_document_id: str = Field(min_length=1)
    geography_ids: list[str] = Field(min_length=1)
    title: str = Field(min_length=1)
    evidence_claim_ids: list[str] = Field(min_length=1)
    measure_ids: list[str] = Field(default_factory=list)
    barrier_observation_ids: list[str] = Field(default_factory=list)
    organization_ids: list[str] = Field(default_factory=list)
    review_status: ReviewStatus


class Organization(StrictModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    organization_type: Literal[
        "county",
        "local_health_department",
        "state_agency",
        "hospital",
        "health_system",
        "foundation",
        "community_organization",
        "funder",
        "academic",
        "other",
    ]
    geography_ids: list[str] = Field(default_factory=list)
    official_url: str | None = None
    visibility: TenantVisibility = TenantVisibility.PUBLIC
    tenant_id: str | None = None


class FundingOpportunity(StrictModel):
    id: str = Field(min_length=1)
    source_document_id: str = Field(min_length=1)
    funder_organization_id: str | None = None
    title: str = Field(min_length=1)
    program_name: str | None = None
    opportunity_number: str | None = None
    open_date: date | None = None
    close_date: date | None = None
    eligible_applicant_types: list[str] = Field(default_factory=list)
    geography_ids: list[str] = Field(default_factory=list)
    requirement_claim_ids: list[str] = Field(default_factory=list)
    review_status: ReviewStatus


class FundingFit(StrictModel):
    id: str = Field(min_length=1)
    opportunity_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    plan_priority_ids: list[str] = Field(default_factory=list)
    barrier_observation_ids: list[str] = Field(default_factory=list)
    designation_evidence_claim_ids: list[str] = Field(default_factory=list)
    supporting_evidence_claim_ids: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    eligibility_status: Literal["likely_eligible", "possibly_eligible", "ineligible", "unknown"]
    fit_status: Literal["strong", "moderate", "weak", "not_recommended", "unreviewed"]
    confidence: Confidence
    review_status: ReviewStatus


class ScenarioAssumption(StrictModel):
    id: str = Field(min_length=1)
    tenant_id: str | None = None
    geography_id: str = Field(min_length=1)
    measure_id: str = Field(min_length=1)
    assumption_type: Literal["absolute_change", "relative_change", "capacity_change", "trend_continuation", "custom"]
    value: float
    unit: str = Field(min_length=1)
    rationale: str = Field(min_length=1)
    evidence_claim_ids: list[str] = Field(default_factory=list)
    created_by: str = Field(min_length=1)


class ForecastResult(StrictModel):
    id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    measure_id: str = Field(min_length=1)
    forecast_type: Literal["trend", "baseline_projection", "scenario_projection"]
    model_version: str = Field(min_length=1)
    horizon_end: date
    point_estimate: float | None = None
    interval_low: float | None = None
    interval_high: float | None = None
    assumption_ids: list[str] = Field(default_factory=list)
    input_measure_ids: list[str] = Field(min_length=1)
    limitations: list[str] = Field(default_factory=list)
    backtest_reference: str | None = None
    review_status: ReviewStatus


class Conflict(StrictModel):
    id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    entity_type: Literal["evidence", "measure", "plan_priority", "funding", "forecast", "policy"]
    entity_ids: list[str] = Field(min_length=2)
    conflict_type: Literal["source_disagreement", "vintage_mismatch", "geography_mismatch", "semantic_conflict", "policy_conflict"]
    summary: str = Field(min_length=1)
    blocking: bool
    review_status: ReviewStatus


class ReviewDecision(StrictModel):
    id: str = Field(min_length=1)
    tenant_id: str | None = None
    entity_type: str = Field(min_length=1)
    entity_id: str = Field(min_length=1)
    decision: Literal["approved", "rejected", "needs_revision", "deferred"]
    decided_by: str = Field(min_length=1)
    decided_at: datetime
    reason: str = Field(min_length=1)


class AgentRun(StrictModel):
    id: str = Field(min_length=1)
    parent_run_id: str | None = None
    agent_name: str = Field(min_length=1)
    agent_version: str = Field(min_length=1)
    status: AgentRunStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    model_provider: str | None = None
    model_name: str | None = None
    input_state_hash: str | None = None
    output_state_hash: str | None = None
    tool_names: list[str] = Field(default_factory=list)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    estimated_cost_usd: float = Field(default=0, ge=0)
    trace_id: str | None = None
    error_code: str | None = None


class PublicationArtifact(StrictModel):
    id: str = Field(min_length=1)
    tenant_id: str | None = None
    geography_id: str = Field(min_length=1)
    artifact_type: Literal["planning_brief", "data_export", "figure", "presentation", "api_snapshot"]
    generated_at: datetime
    content_hash: str = Field(min_length=16)
    source_entity_ids: list[str] = Field(default_factory=list)
    visibility: TenantVisibility
    approval_decision_id: str | None = None


class WorkflowFlags(StrictModel):
    """Deterministic control state. These flags, not prompts, authorize transitions."""

    geography_verified: bool = False
    required_sources_complete: bool = False
    evidence_validated: bool = False
    source_conflict: bool = False
    blocking_conflict: bool = False
    needs_human_review: bool = False
    review_complete: bool = False
    policy_passed: bool = False
    budget_exceeded: bool = False
    cancel_requested: bool = False
    safe_to_publish: bool = False
    publication_approved: bool = False

    def publication_preconditions_met(self) -> bool:
        return (
            self.geography_verified
            and self.required_sources_complete
            and self.evidence_validated
            and not self.source_conflict
            and not self.blocking_conflict
            and not self.needs_human_review
            and self.policy_passed
            and not self.budget_exceeded
            and not self.cancel_requested
        )


class CountyRunState(StrictModel):
    schema_version: Literal["cbcap.county-run.v1"] = "cbcap.county-run.v1"
    run_id: str = Field(min_length=1)
    tenant_id: str | None = None
    county: GeographyRef
    requested_at: datetime
    status: RunStatus = RunStatus.CREATED
    flags: WorkflowFlags = Field(default_factory=WorkflowFlags)
    source_documents: list[SourceDocument] = Field(default_factory=list)
    evidence_claims: list[EvidenceClaim] = Field(default_factory=list)
    measures: list[Measure] = Field(default_factory=list)
    barrier_observations: list[BarrierObservation] = Field(default_factory=list)
    barrier_patterns: list[BarrierPattern] = Field(default_factory=list)
    plan_documents: list[PlanDocument] = Field(default_factory=list)
    plan_priorities: list[PlanPriority] = Field(default_factory=list)
    organizations: list[Organization] = Field(default_factory=list)
    funding_opportunities: list[FundingOpportunity] = Field(default_factory=list)
    funding_fits: list[FundingFit] = Field(default_factory=list)
    scenario_assumptions: list[ScenarioAssumption] = Field(default_factory=list)
    forecasts: list[ForecastResult] = Field(default_factory=list)
    conflicts: list[Conflict] = Field(default_factory=list)
    reviews: list[ReviewDecision] = Field(default_factory=list)
    agent_runs: list[AgentRun] = Field(default_factory=list)
    artifacts: list[PublicationArtifact] = Field(default_factory=list)

    @model_validator(mode="after")
    def enforce_county_and_publication_policy(self) -> "CountyRunState":
        if self.county.kind != GeographyKind.COUNTY:
            raise ValueError("CountyRunState requires a county geography")
        if self.flags.safe_to_publish and not self.flags.publication_preconditions_met():
            raise ValueError("safe_to_publish cannot be true until deterministic preconditions are met")
        if self.flags.publication_approved and not self.flags.safe_to_publish:
            raise ValueError("publication_approved requires safe_to_publish")
        if self.status == RunStatus.COMPLETED and self.flags.cancel_requested:
            raise ValueError("cancelled work cannot be marked completed")
        return self
