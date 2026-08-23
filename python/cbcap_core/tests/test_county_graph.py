from datetime import date, datetime, timezone
from hashlib import sha256

from cbcap_core import (
    CitationLocator,
    Confidence,
    CountyGraphContext,
    CountyRunState,
    DocumentTrust,
    EvidenceClaim,
    ExtractionMethod,
    GeographyKind,
    GeographyRef,
    Measure,
    MetricSemantics,
    PlanDocument,
    ReviewStatus,
    RunStatus,
    SourceDocument,
    SourceVersionRef,
    TenantVisibility,
    build_county_planning_graph,
    initial_graph_state,
)
from cbcap_core.gateway import PublicEvidencePackage, SourceCoverageAssertion
from cbcap_core.planning_evidence import (
    PlanningDocumentPage,
    PlanningEvidenceAdmissionRequest,
    PlanningExtractionProposal,
)
from cbcap_core.planning_pipeline import PlanningPipelineRequest
from cbcap_core.planning_research import (
    ApprovedPlanningSource,
    PlanningDocumentCandidate,
    PlanningResearchRequest,
)

NOW = datetime(2026, 8, 22, 22, 0, tzinfo=timezone.utc)
EXCERPT = "Transportation barriers were identified as a priority access issue."


def county(fips: str = "42029", state_fips: str = "42", name: str = "Chester County, Pennsylvania") -> GeographyRef:
    return GeographyRef(
        id=f"county:{fips}",
        kind=GeographyKind.COUNTY,
        authority="census",
        authority_id=fips,
        name=name,
        display_name=name,
        state_fips=state_fips,
        county_fips=fips,
        vintage="2025",
        review_status=ReviewStatus.VERIFIED,
    )


def source(source_id: str, title: str = "Official source") -> SourceVersionRef:
    return SourceVersionRef(
        source_id=source_id,
        source_version_id=f"{source_id}:2026",
        publisher="Official publisher",
        title=title,
        official_url="https://example.gov/source",
        release_label="2026",
        release_date=date(2026, 1, 1),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="public-evidence-v1",
        review_status=ReviewStatus.VERIFIED,
    )


def transportation_measure() -> Measure:
    semantics = MetricSemantics(
        id="metric:transportation",
        source_measure_id="LACKTRPT",
        name="Lack of reliable transportation",
        description="Controlled county graph transportation measure.",
        direction="adverse",
        higher_value_meaning="adverse",
        unit="percent",
        universe="adults",
        adjustment="modeled",
        comparison_policy="higher_is_concern",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )
    return Measure(
        id="measure:transportation:42029:2026",
        semantics=semantics,
        geography=county(),
        source_version=source("cdc-places", "PLACES"),
        geography_level="county",
        value=10.0,
        numeric_value=10.0,
        source_metadata={},
        review_status=ReviewStatus.VERIFIED,
    )


def hpsa_measure() -> Measure:
    semantics = MetricSemantics(
        id="metric:hpsa",
        source_measure_id="HPSA_DESIGNATION",
        name="Current HRSA shortage-area designation",
        description="Controlled county graph HPSA measure.",
        direction="contextual",
        higher_value_meaning="context_dependent",
        unit="designation",
        universe="HRSA HPSA designations",
        adjustment="not_applicable",
        comparison_policy="context_only",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )
    return Measure(
        id="measure:hpsa:primary:42029",
        semantics=semantics,
        geography=county(),
        source_version=source("hrsa-workforce", "HPSA"),
        geography_level="county",
        value="Designated",
        numeric_value=13.0,
        data_period_start=date(2024, 1, 1),
        source_metadata={
            "designationName": "Controlled Chester Primary Care HPSA",
            "designationType": "Geographic HPSA",
            "componentType": "Single County",
            "discipline": "Primary Care",
            "designationStatus": "Designated",
            "lastUpdateDate": "2026-08-20",
            "wholeCountyGeographicDesignation": True,
            "sourceGeographyIdentificationNumber": "42029",
        },
        review_status=ReviewStatus.VERIFIED,
    )


def coverage(key: str, status: str, records: int) -> SourceCoverageAssertion:
    return SourceCoverageAssertion(
        id=f"coverage:{key}:42029",
        source_id="hrsa-workforce",
        source_version_id=source("hrsa-workforce", "HPSA").source_version_id,
        geography_id=county().id,
        coverage_key=key,
        status=status,
        records_matched=records,
        evaluated_at=NOW,
        review_status=ReviewStatus.VERIFIED,
    )


def gateway_package() -> dict:
    transport = transportation_measure()
    shortage = hpsa_measure()
    return PublicEvidencePackage(
        release_id="county-graph-integration-release",
        generated_at=NOW,
        geographies=[county()],
        metric_semantics=[transport.semantics, shortage.semantics],
        measures=[transport, shortage],
        source_versions=[transport.source_version, shortage.source_version],
        source_coverage=[
            coverage("hpsa:primary_care", "complete_with_records", 1),
            coverage("hpsa:dental", "complete_no_records", 0),
            coverage("hpsa:mental_health", "complete_no_records", 0),
        ],
    ).model_dump(mode="json")


def base_run() -> CountyRunState:
    return CountyRunState(
        run_id="county-graph-integration",
        county=county(),
        requested_at=NOW,
    )


def planning_pipeline_request(*, request_county: GeographyRef | None = None, verified_claim: bool = True) -> PlanningPipelineRequest:
    target = request_county or county()
    seed = ApprovedPlanningSource(
        id="seed:chester-health",
        source_family="county_local_health_department",
        publisher="Chester County Health Department",
        approved_hosts=["www.chesco.org"],
        source_page_url="https://www.chesco.org/health/chip",
        geography_ids=[target.id],
    )
    candidate = PlanningDocumentCandidate(
        id="candidate:chester-chip",
        source_seed_id=seed.id,
        source_family=seed.source_family,
        publisher=seed.publisher,
        source_page_url=seed.source_page_url,
        artifact_url="https://www.chesco.org/health/files/chip.pdf",
        document_type="chip",
        title="Community Health Improvement Plan",
        covered_geography_ids=[target.id],
        coverage_scope="county_specific",
        publication_date=date(2026, 6, 1),
        plan_cycle_start=date(2026, 1, 1),
        plan_cycle_end=date(2029, 12, 31),
        retrieved_at=NOW,
        candidate_confidence="high",
        candidate_confidence_score=0.99,
        confidence_reasons=["official county health department page"],
    )
    source_doc = SourceDocument(
        id="document:chester-chip",
        source_version=SourceVersionRef(
            source_id="local-planning-documents",
            source_version_id="source-version:chester-chip",
            publisher=seed.publisher,
            title=candidate.title,
            official_url=candidate.artifact_url,
            release_label="2026 CHIP",
            release_date=date(2026, 6, 1),
            retrieved_at=NOW,
            content_hash="sha256:" + "b" * 64,
            schema_version="planning-document.v1",
            review_status=ReviewStatus.VERIFIED,
        ),
        document_type="chip",
        geography_ids=[target.id],
        content_hash="sha256:" + "c" * 64,
        content_locator="s3://cbcap-evidence/chester/chip.pdf",
        page_count=30,
        trust=DocumentTrust.OFFICIAL_VERIFIED,
        visibility=TenantVisibility.PUBLIC,
        review_status=ReviewStatus.VERIFIED,
    )
    plan = PlanDocument(
        id="plan:chester-chip",
        source_document_id=source_doc.id,
        document_type="chip",
        title=candidate.title,
        publisher=seed.publisher,
        geography_ids=[target.id],
        published_at=date(2026, 6, 1),
        period_start=date(2026, 1, 1),
        period_end=date(2029, 12, 31),
        current_plan_status="verified_current",
        review_status=ReviewStatus.VERIFIED,
    )
    claim = EvidenceClaim(
        id="claim:chester-transportation",
        source_document_id=source_doc.id,
        geography_ids=[target.id],
        claim_type="barrier",
        statement="Transportation is an explicitly documented access priority.",
        citation=CitationLocator(
            page_number=12,
            section="Access barriers",
            quoted_text_hash="sha256:" + sha256(EXCERPT.encode("utf-8")).hexdigest(),
        ),
        extraction_method=ExtractionMethod.STRUCTURED_PARSER,
        confidence=Confidence.HIGH,
        review_status=ReviewStatus.VERIFIED if verified_claim else ReviewStatus.PROVISIONAL,
    )
    admission = PlanningEvidenceAdmissionRequest(
        candidate=candidate,
        source_document=source_doc,
        plan_document=plan,
        pages=[PlanningDocumentPage(page_number=12, section="Access barriers", text=EXCERPT)],
        proposals=[
            PlanningExtractionProposal(
                id="proposal:chester-transportation",
                candidate_id=candidate.id,
                claim=claim,
                exact_excerpt=EXCERPT,
                explicit_statement=True,
            )
        ],
    )
    return PlanningPipelineRequest(
        research=PlanningResearchRequest(
            run_id="planning:chester",
            county=target,
            approved_sources=[seed],
            candidate_documents=[candidate],
        ),
        admission_requests=[admission],
    )


def config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}


def test_empty_county_graph_fails_closed():
    graph = build_county_planning_graph()
    run = CountyRunState(run_id="empty", county=county(), requested_at=NOW)
    result = graph.invoke(initial_graph_state(run), config=config("empty"), context=CountyGraphContext())
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.BLOCKED
    assert final.flags.required_sources_complete is False
    assert final.flags.safe_to_publish is False


def test_verified_planning_pipeline_enters_parent_graph_and_preserves_trajectory():
    graph = build_county_planning_graph()
    run = base_run()
    result = graph.invoke(
        initial_graph_state(run),
        config=config("planning-integrated"),
        context=CountyGraphContext(
            public_evidence_package=gateway_package(),
            planning_pipeline_request=planning_pipeline_request().model_dump(mode="json"),
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.COMPLETED
    assert final.flags.safe_to_publish is True
    assert [item.id for item in final.plan_documents] == ["plan:chester-chip"]
    assert [item.id for item in final.evidence_claims] == ["claim:chester-transportation"]
    assert any(
        item["stage"] == "document_admission" and item["outcome"] == "accepted"
        for item in result["trajectory_events"]
    )


def test_provisional_planning_claim_blocks_parent_graph():
    graph = build_county_planning_graph()
    run = base_run()
    result = graph.invoke(
        initial_graph_state(run),
        config=config("planning-provisional"),
        context=CountyGraphContext(
            public_evidence_package=gateway_package(),
            planning_pipeline_request=planning_pipeline_request(verified_claim=False).model_dump(mode="json"),
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.BLOCKED
    assert final.flags.safe_to_publish is False
    assert final.plan_documents == []
    assert any(
        item["stage"] == "claim_admission"
        and item["outcome"] == "review_required"
        and "formal_verification_required" in item["reason_codes"]
        for item in result["trajectory_events"]
    )


def test_planning_request_for_another_county_is_rejected_before_merge():
    graph = build_county_planning_graph()
    run = base_run()
    wrong_county = county("36001", "36", "Albany County, New York")
    result = graph.invoke(
        initial_graph_state(run),
        config=config("planning-wrong-county"),
        context=CountyGraphContext(
            public_evidence_package=gateway_package(),
            planning_pipeline_request=planning_pipeline_request(request_county=wrong_county).model_dump(mode="json"),
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.BLOCKED
    assert final.plan_documents == []
    assert any(
        "planning_request_geography_mismatch" in item["reason_codes"]
        for item in result["trajectory_events"]
    )
