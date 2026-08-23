from datetime import date, datetime, timezone
from hashlib import sha256

from cbcap_core.models import (
    CitationLocator,
    Confidence,
    DocumentTrust,
    EvidenceClaim,
    ExtractionMethod,
    GeographyKind,
    GeographyRef,
    PlanDocument,
    ReviewStatus,
    SourceDocument,
    SourceVersionRef,
    TenantVisibility,
)
from cbcap_core.planning_evidence import (
    PlanningDocumentPage,
    PlanningEvidenceAdmissionRequest,
    PlanningExtractionProposal,
)
from cbcap_core.planning_pipeline import PlanningPipelineRequest, run_planning_pipeline
from cbcap_core.planning_research import (
    ApprovedPlanningSource,
    PlanningDocumentCandidate,
    PlanningResearchRequest,
)

NOW = datetime(2026, 8, 22, 22, 0, tzinfo=timezone.utc)
EXCERPT = "Housing affordability was identified as a major community priority."


def county() -> GeographyRef:
    return GeographyRef(
        id="county:42029",
        kind=GeographyKind.COUNTY,
        authority="census",
        authority_id="42029",
        name="Chester County",
        display_name="Chester County, Pennsylvania",
        state_fips="42",
        county_fips="42029",
        vintage="2025",
        review_status=ReviewStatus.VERIFIED,
    )


def approved_source() -> ApprovedPlanningSource:
    return ApprovedPlanningSource(
        id="seed:chester",
        source_family="county_local_health_department",
        publisher="Chester County Health Department",
        approved_hosts=["www.chesco.org"],
        source_page_url="https://www.chesco.org/health/chip",
        geography_ids=[county().id],
    )


def candidate(*, artifact_url: str = "https://www.chesco.org/health/files/chip.pdf") -> PlanningDocumentCandidate:
    return PlanningDocumentCandidate(
        id="candidate:chester-chip",
        source_seed_id="seed:chester",
        source_family="county_local_health_department",
        publisher="Chester County Health Department",
        source_page_url="https://www.chesco.org/health/chip",
        artifact_url=artifact_url,
        document_type="chip",
        title="Community Health Improvement Plan",
        covered_geography_ids=[county().id],
        coverage_scope="county_specific",
        publication_date=date(2026, 6, 1),
        plan_cycle_start=date(2026, 1, 1),
        plan_cycle_end=date(2029, 12, 31),
        retrieved_at=NOW,
        candidate_confidence="high",
        candidate_confidence_score=0.99,
        confidence_reasons=["official county source"],
    )


def source_version() -> SourceVersionRef:
    return SourceVersionRef(
        source_id="local-planning-documents",
        source_version_id="source-version:chester-chip",
        publisher="Chester County Health Department",
        title="Community Health Improvement Plan",
        official_url="https://www.chesco.org/health/files/chip.pdf",
        release_label="2026 CHIP",
        release_date=date(2026, 6, 1),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="planning-document.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def admission(plan_candidate: PlanningDocumentCandidate, *, verified_claim: bool = True) -> PlanningEvidenceAdmissionRequest:
    source_document = SourceDocument(
        id="document:chester-chip",
        source_version=source_version(),
        document_type="chip",
        geography_ids=[county().id],
        content_hash="sha256:" + "b" * 64,
        content_locator="s3://cbcap-evidence/chester/chip.pdf",
        page_count=30,
        trust=DocumentTrust.OFFICIAL_VERIFIED,
        visibility=TenantVisibility.PUBLIC,
        review_status=ReviewStatus.VERIFIED,
    )
    plan_document = PlanDocument(
        id="plan:chester-chip",
        source_document_id=source_document.id,
        document_type="chip",
        title="Community Health Improvement Plan",
        publisher="Chester County Health Department",
        geography_ids=[county().id],
        published_at=date(2026, 6, 1),
        period_start=date(2026, 1, 1),
        period_end=date(2029, 12, 31),
        current_plan_status="verified_current",
        review_status=ReviewStatus.VERIFIED,
    )
    claim = EvidenceClaim(
        id="claim:chester-housing",
        source_document_id=source_document.id,
        geography_ids=[county().id],
        claim_type="priority",
        statement="Housing affordability is a documented community priority.",
        citation=CitationLocator(
            page_number=13,
            section="Community priorities",
            quoted_text_hash="sha256:" + sha256(EXCERPT.encode("utf-8")).hexdigest(),
        ),
        extraction_method=ExtractionMethod.STRUCTURED_PARSER,
        confidence=Confidence.HIGH,
        review_status=ReviewStatus.VERIFIED if verified_claim else ReviewStatus.PROVISIONAL,
    )
    return PlanningEvidenceAdmissionRequest(
        candidate=plan_candidate,
        source_document=source_document,
        plan_document=plan_document,
        pages=[
            PlanningDocumentPage(
                page_number=13,
                section="Community priorities",
                text=f"Survey findings. {EXCERPT} Additional context.",
            )
        ],
        proposals=[
            PlanningExtractionProposal(
                id="proposal:chester-housing",
                candidate_id=plan_candidate.id,
                claim=claim,
                exact_excerpt=EXCERPT,
                explicit_statement=True,
            )
        ],
    )


def research(plan_candidate: PlanningDocumentCandidate) -> PlanningResearchRequest:
    return PlanningResearchRequest(
        run_id="planning-pipeline-run",
        county=county(),
        approved_sources=[approved_source()],
        candidate_documents=[plan_candidate],
    )


def test_pipeline_admits_verified_plan_and_records_trajectory():
    plan_candidate = candidate()
    result = run_planning_pipeline(
        PlanningPipelineRequest(
            research=research(plan_candidate),
            admission_requests=[admission(plan_candidate)],
        )
    )
    assert result.ready_for_county_graph is True
    assert [item.id for item in result.admitted_plan_documents] == ["plan:chester-chip"]
    assert [item.id for item in result.admitted_claims] == ["claim:chester-housing"]
    assert {(item.stage, item.outcome) for item in result.trajectory} >= {
        ("candidate_policy", "accepted"),
        ("document_admission", "accepted"),
        ("claim_admission", "accepted"),
    }


def test_pipeline_records_missing_admission_as_review_required():
    plan_candidate = candidate()
    result = run_planning_pipeline(
        PlanningPipelineRequest(
            research=research(plan_candidate),
            admission_requests=[],
        )
    )
    assert result.ready_for_county_graph is False
    event = next(item for item in result.trajectory if item.stage == "document_admission")
    assert event.outcome == "review_required"
    assert "admission_request_missing" in event.reason_codes


def test_rejected_candidate_never_enters_document_admission():
    bad_candidate = candidate(artifact_url="https://attacker.example/chip.pdf")
    result = run_planning_pipeline(
        PlanningPipelineRequest(
            research=research(bad_candidate),
            admission_requests=[admission(bad_candidate)],
        )
    )
    assert result.ready_for_county_graph is False
    assert result.admitted_plan_documents == []
    assert any(
        item.stage == "candidate_policy"
        and item.outcome == "rejected"
        and "candidate artifact host is not approved HTTPS" in item.reason_codes
        for item in result.trajectory
    )
    assert any(
        item.stage == "document_admission"
        and item.outcome == "rejected"
        and "candidate_not_approved" in item.reason_codes
        for item in result.trajectory
    )


def test_provisional_claim_stays_out_of_canonical_admitted_claims():
    plan_candidate = candidate()
    result = run_planning_pipeline(
        PlanningPipelineRequest(
            research=research(plan_candidate),
            admission_requests=[admission(plan_candidate, verified_claim=False)],
        )
    )
    assert result.ready_for_county_graph is False
    assert result.admitted_claims == []
    assert any(
        item.stage == "claim_admission"
        and item.outcome == "review_required"
        and "formal_verification_required" in item.reason_codes
        for item in result.trajectory
    )
