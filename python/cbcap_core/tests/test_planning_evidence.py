from datetime import date, datetime, timezone
from hashlib import sha256

from cbcap_core.models import (
    CitationLocator,
    Confidence,
    DocumentTrust,
    EvidenceClaim,
    ExtractionMethod,
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
    admit_planning_evidence,
)
from cbcap_core.planning_research import PlanningDocumentCandidate

NOW = datetime(2026, 8, 22, 22, 0, tzinfo=timezone.utc)
EXCERPT = "Transportation barriers were identified as a priority access issue."


def source_version() -> SourceVersionRef:
    return SourceVersionRef(
        source_id="local-planning-documents",
        source_version_id="source-version:chester-chip-2026",
        publisher="Chester County Health Department",
        title="2026 Community Health Improvement Plan",
        official_url="https://www.chesco.org/health/chip",
        release_label="2026 CHIP",
        release_date=date(2026, 6, 1),
        data_period_start=date(2026, 1, 1),
        data_period_end=date(2029, 12, 31),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="planning-document.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def candidate(*, scope: str = "county_specific") -> PlanningDocumentCandidate:
    return PlanningDocumentCandidate(
        id="candidate:chester-chip-2026",
        source_seed_id="seed:chester-health",
        source_family="county_local_health_department",
        publisher="Chester County Health Department",
        source_page_url="https://www.chesco.org/health/chip",
        artifact_url="https://www.chesco.org/health/files/chip-2026.pdf",
        document_type="chip",
        title="2026 Community Health Improvement Plan",
        covered_geography_ids=["county:42029"],
        coverage_scope=scope,
        publication_date=date(2026, 6, 1),
        plan_cycle_start=date(2026, 1, 1),
        plan_cycle_end=date(2029, 12, 31),
        retrieved_at=NOW,
        candidate_confidence="high",
        candidate_confidence_score=0.99,
        confidence_reasons=["official county health department page"],
    )


def source_document(*, verified: bool = True) -> SourceDocument:
    return SourceDocument(
        id="document:chester-chip-2026",
        source_version=source_version(),
        document_type="chip",
        geography_ids=["county:42029"],
        content_hash="sha256:" + "b" * 64,
        content_locator="s3://cbcap-evidence/chester/chip-2026.pdf",
        page_count=40,
        trust=DocumentTrust.OFFICIAL_VERIFIED if verified else DocumentTrust.UNTRUSTED_EXTERNAL,
        visibility=TenantVisibility.PUBLIC,
        review_status=ReviewStatus.VERIFIED if verified else ReviewStatus.PROVISIONAL,
    )


def plan_document(*, current: bool = True, scope_geography: str = "county:42029") -> PlanDocument:
    return PlanDocument(
        id="plan:chester-chip-2026",
        source_document_id="document:chester-chip-2026",
        document_type="chip",
        title="2026 Community Health Improvement Plan",
        publisher="Chester County Health Department",
        geography_ids=[scope_geography],
        published_at=date(2026, 6, 1),
        period_start=date(2026, 1, 1),
        period_end=date(2029, 12, 31),
        current_plan_status="verified_current" if current else "not_yet_verified",
        review_status=ReviewStatus.VERIFIED,
    )


def claim(*, confidence: Confidence = Confidence.HIGH, review: ReviewStatus = ReviewStatus.VERIFIED, excerpt: str = EXCERPT) -> EvidenceClaim:
    return EvidenceClaim(
        id="claim:chester-transportation",
        source_document_id="document:chester-chip-2026",
        geography_ids=["county:42029"],
        claim_type="barrier",
        statement="Transportation is an explicitly documented access priority.",
        citation=CitationLocator(
            page_number=12,
            section="Access barriers",
            quoted_text_hash="sha256:" + sha256(excerpt.encode("utf-8")).hexdigest(),
        ),
        extraction_method=ExtractionMethod.STRUCTURED_PARSER,
        confidence=confidence,
        review_status=review,
    )


def request(
    *,
    evidence_claim: EvidenceClaim | None = None,
    excerpt: str = EXCERPT,
    explicit: bool = True,
    source: SourceDocument | None = None,
    plan: PlanDocument | None = None,
    plan_candidate: PlanningDocumentCandidate | None = None,
) -> PlanningEvidenceAdmissionRequest:
    evidence_claim = evidence_claim or claim()
    return PlanningEvidenceAdmissionRequest(
        candidate=plan_candidate or candidate(),
        source_document=source or source_document(),
        plan_document=plan or plan_document(),
        pages=[
            PlanningDocumentPage(
                page_number=12,
                section="Access barriers",
                text=f"Background. {EXCERPT} Additional planning detail.",
            )
        ],
        proposals=[
            PlanningExtractionProposal(
                id="proposal:chester-transportation",
                candidate_id="candidate:chester-chip-2026",
                claim=evidence_claim,
                exact_excerpt=excerpt,
                explicit_statement=explicit,
            )
        ],
    )


def test_verified_exact_claim_is_admitted_to_county_graph():
    result = admit_planning_evidence(request())
    assert result.ready_for_county_graph is True
    assert result.public_eligibility is False
    assert [item.id for item in result.accepted_claims] == ["claim:chester-transportation"]
    assert result.quarantined_claims == []
    assert result.review_tasks == []


def test_citation_mismatch_is_quarantined():
    result = admit_planning_evidence(request(excerpt="A sentence that does not occur on the cited page."))
    assert result.ready_for_county_graph is False
    assert [item.id for item in result.quarantined_claims] == ["claim:chester-transportation"]
    assert any(item.reason == "citation_text_mismatch" for item in result.review_tasks)


def test_low_confidence_claim_is_quarantined_even_when_excerpt_matches():
    result = admit_planning_evidence(request(evidence_claim=claim(confidence=Confidence.LOW)))
    assert result.ready_for_county_graph is False
    assert len(result.quarantined_claims) == 1
    assert any(item.reason == "extraction_confidence_low" for item in result.review_tasks)


def test_provisional_claim_requires_formal_review_and_is_not_graph_ready():
    result = admit_planning_evidence(request(evidence_claim=claim(review=ReviewStatus.PROVISIONAL)))
    assert len(result.accepted_claims) == 1
    assert result.ready_for_county_graph is False
    assert any(item.reason == "formal_verification_required" for item in result.review_tasks)


def test_regional_document_cannot_be_designated_as_current_county_plan():
    result = admit_planning_evidence(
        request(
            plan_candidate=candidate(scope="regional"),
            plan=plan_document(current=True),
        )
    )
    assert result.ready_for_county_graph is False
    assert any(
        item.reason == "current_plan_not_verified" and item.severity == "blocking"
        for item in result.review_tasks
    )


def test_unverified_source_document_blocks_admission():
    result = admit_planning_evidence(request(source=source_document(verified=False)))
    assert result.ready_for_county_graph is False
    assert any(
        item.reason == "document_not_verified" and item.severity == "blocking"
        for item in result.review_tasks
    )
