from datetime import date, datetime, timezone

from cbcap_core.evidence_graph_policy import build_governed_evidence_graph
from cbcap_core.models import (
    BarrierFamily,
    BarrierObservation,
    CitationLocator,
    Confidence,
    CountyRunState,
    DocumentTrust,
    EvidenceClaim,
    ExtractionMethod,
    ForecastResult,
    FundingFit,
    FundingOpportunity,
    GeographyKind,
    GeographyRef,
    Measure,
    MetricSemantics,
    Organization,
    PlanDocument,
    PlanPriority,
    ReviewStatus,
    ScenarioAssumption,
    SourceDocument,
    SourceVersionRef,
    TenantVisibility,
)

NOW = datetime(2026, 8, 22, 23, 0, tzinfo=timezone.utc)
TENANT = "tenant:county-planning-team"


def county() -> GeographyRef:
    return GeographyRef(
        id="county:36001",
        kind=GeographyKind.COUNTY,
        authority="census",
        authority_id="36001",
        name="Albany County",
        display_name="Albany County, New York",
        state_fips="36",
        county_fips="36001",
        vintage="2025",
        review_status=ReviewStatus.VERIFIED,
    )


def source_version(source_id: str, title: str) -> SourceVersionRef:
    return SourceVersionRef(
        source_id=source_id,
        source_version_id=f"{source_id}:2026",
        publisher="Official publisher",
        title=title,
        official_url="https://example.gov/source",
        release_label="2026",
        release_date=date(2026, 8, 1),
        retrieved_at=NOW,
        content_hash="sha256:" + source_id.replace("-", "a")[:8].ljust(64, "a"),
        schema_version="test.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def metric() -> MetricSemantics:
    return MetricSemantics(
        id="metric:transportation",
        source_measure_id="LACKTRPT",
        name="Lack of reliable transportation",
        description="Controlled evidence graph test metric.",
        direction="adverse",
        higher_value_meaning="adverse",
        unit="percent",
        universe="adults",
        adjustment="modeled",
        comparison_policy="higher_is_concern",
        trendable=True,
        forecastable=True,
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )


def build_run(*, tenant_id: str = TENANT, fit_tenant_id: str = TENANT, missing_measure_ref: bool = False) -> CountyRunState:
    planning_source = SourceDocument(
        id="document:chip",
        source_version=source_version("local-planning", "Albany County CHIP"),
        document_type="chip",
        geography_ids=[county().id],
        content_hash="sha256:" + "b" * 64,
        content_locator="s3://cbcap-evidence/albany/chip.pdf",
        trust=DocumentTrust.OFFICIAL_VERIFIED,
        visibility=TenantVisibility.PUBLIC,
        review_status=ReviewStatus.VERIFIED,
    )
    funding_source = SourceDocument(
        id="document:funding",
        source_version=source_version("grants-gov", "Federal funding notice"),
        document_type="funding_notice",
        geography_ids=[county().id],
        content_hash="sha256:" + "c" * 64,
        content_locator="s3://cbcap-evidence/funding/opportunity.pdf",
        trust=DocumentTrust.OFFICIAL_VERIFIED,
        visibility=TenantVisibility.PUBLIC,
        review_status=ReviewStatus.VERIFIED,
    )
    claim = EvidenceClaim(
        id="claim:transportation-priority",
        source_document_id=planning_source.id,
        geography_ids=[county().id],
        claim_type="priority",
        statement="Transportation access is an identified planning priority.",
        citation=CitationLocator(page_number=8, section="Priorities"),
        extraction_method=ExtractionMethod.STRUCTURED_PARSER,
        confidence=Confidence.HIGH,
        review_status=ReviewStatus.VERIFIED,
    )
    measure = Measure(
        id="measure:transportation:36001:2026",
        semantics=metric(),
        geography=county(),
        source_version=source_version("cdc-places", "CDC PLACES"),
        geography_level="county",
        value=10.0,
        numeric_value=10.0,
        review_status=ReviewStatus.VERIFIED,
    )
    barrier = BarrierObservation(
        id="barrier:transportation:36001",
        barrier_family=BarrierFamily.TRANSPORTATION_TRAVEL,
        geography=county(),
        measure_id=measure.id,
        evidence_claim_ids=[claim.id],
        observed_value=10.0,
        evidence_quality="high",
        review_status=ReviewStatus.VERIFIED,
    )
    plan = PlanDocument(
        id="plan:albany-chip",
        source_document_id=planning_source.id,
        document_type="chip",
        title="Albany County Community Health Improvement Plan",
        publisher="Albany County",
        geography_ids=[county().id],
        published_at=date(2026, 1, 1),
        current_plan_status="verified_current",
        review_status=ReviewStatus.VERIFIED,
    )
    organization = Organization(
        id="organization:albany-health",
        name="Albany County Department of Health",
        organization_type="local_health_department",
        geography_ids=[county().id],
        official_url="https://example.gov/health",
    )
    priority = PlanPriority(
        id="priority:transportation",
        plan_document_id=plan.id,
        geography_ids=[county().id],
        title="Improve transportation access",
        evidence_claim_ids=[claim.id],
        measure_ids=["measure:missing" if missing_measure_ref else measure.id],
        barrier_observation_ids=[barrier.id],
        organization_ids=[organization.id],
        review_status=ReviewStatus.VERIFIED,
    )
    opportunity = FundingOpportunity(
        id="funding:transport-access",
        source_document_id=funding_source.id,
        title="Community Access Improvement Program",
        open_date=date(2026, 8, 1),
        close_date=date(2026, 10, 31),
        eligible_applicant_types=["local_health_department"],
        geography_ids=[county().id],
        requirement_claim_ids=[],
        review_status=ReviewStatus.VERIFIED,
    )
    fit = FundingFit(
        id="funding-fit:transport-access",
        opportunity_id=opportunity.id,
        tenant_id=fit_tenant_id,
        geography_id=county().id,
        plan_priority_ids=[priority.id],
        barrier_observation_ids=[barrier.id],
        supporting_evidence_claim_ids=[claim.id],
        eligibility_status="likely_eligible",
        fit_status="strong",
        confidence=Confidence.HIGH,
        review_status=ReviewStatus.VERIFIED,
    )
    assumption = ScenarioAssumption(
        id="assumption:transportation",
        tenant_id=tenant_id,
        geography_id=county().id,
        measure_id=measure.id,
        assumption_type="absolute_change",
        value=-1.0,
        unit="percent",
        rationale="Test an explicit planning scenario.",
        evidence_claim_ids=[claim.id],
        created_by="planner:test",
    )
    forecast = ForecastResult(
        id="forecast:transportation:scenario",
        geography_id=county().id,
        measure_id=measure.id,
        forecast_type="scenario_projection",
        model_version="cbcap-deterministic-scenario-v1",
        horizon_end=date(2027, 12, 31),
        point_estimate=9.0,
        assumption_ids=[assumption.id],
        input_measure_ids=[measure.id],
        limitations=["Planning scenario only."],
        review_status=ReviewStatus.PROVISIONAL,
    )
    return CountyRunState(
        run_id="evidence-graph-test",
        tenant_id=tenant_id,
        county=county(),
        requested_at=NOW,
        source_documents=[planning_source, funding_source],
        evidence_claims=[claim],
        measures=[measure],
        barrier_observations=[barrier],
        plan_documents=[plan],
        plan_priorities=[priority],
        organizations=[organization],
        funding_opportunities=[opportunity],
        funding_fits=[fit],
        scenario_assumptions=[assumption],
        forecasts=[forecast],
    )


def test_governed_graph_connects_verified_planning_and_funding_state():
    snapshot = build_governed_evidence_graph(build_run())
    assert snapshot.status == "ready"
    assert snapshot.integrity_issues == []

    relationships = {item.relationship for item in snapshot.authoritative_edges}
    assert "barrier_supported_by_measure" in relationships
    assert "priority_belongs_to_plan" in relationships
    assert "priority_addresses_barrier" in relationships
    assert "priority_involves_organization" in relationships
    assert "funding_fit_matches_opportunity" in relationships
    assert "funding_fit_supports_priority" in relationships
    assert "funding_fit_addresses_barrier" in relationships


def test_provisional_forecast_relationships_are_not_authoritative():
    snapshot = build_governed_evidence_graph(build_run())
    forecast_edges = [item for item in snapshot.edges if item.from_node_id.startswith("node:forecast:")]
    assert forecast_edges
    assert all(item.authoritative is False for item in forecast_edges)


def test_tenant_owned_decision_nodes_are_normalized_to_tenant_visibility():
    snapshot = build_governed_evidence_graph(build_run())
    owned = [
        item
        for item in snapshot.nodes
        if item.node_type in {"funding_fit", "scenario_assumption"}
    ]
    assert owned
    assert all(item.visibility == TenantVisibility.TENANT for item in owned)
    assert all(item.tenant_id == TENANT for item in owned)


def test_missing_relationship_reference_blocks_graph_instead_of_dropping_edge():
    snapshot = build_governed_evidence_graph(build_run(missing_measure_ref=True))
    assert snapshot.status == "blocked"
    assert any(
        item.code == "relationship_reference_missing"
        and "measure:missing" in " ".join(item.entity_ids)
        for item in snapshot.integrity_issues
    )


def test_cross_tenant_funding_fit_blocks_graph():
    snapshot = build_governed_evidence_graph(
        build_run(fit_tenant_id="tenant:another-organization")
    )
    assert snapshot.status == "blocked"
    assert any(item.code == "cross_tenant_entity" for item in snapshot.integrity_issues)
