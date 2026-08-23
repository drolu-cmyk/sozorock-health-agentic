from __future__ import annotations

from hashlib import sha256
from typing import Literal

from pydantic import Field

from .models import (
    Confidence,
    DocumentTrust,
    EvidenceClaim,
    PlanDocument,
    ReviewStatus,
    SourceDocument,
    StrictModel,
    TenantVisibility,
)
from .planning_research import PlanningDocumentCandidate


PlanningReviewReason = Literal[
    "document_not_verified",
    "document_scope_mismatch",
    "source_document_mismatch",
    "claim_document_mismatch",
    "citation_locator_missing",
    "citation_text_mismatch",
    "claim_not_explicit",
    "extraction_confidence_low",
    "formal_verification_required",
    "current_plan_not_verified",
]
PlanningReviewSeverity = Literal["blocking", "review_required"]


class PlanningDocumentPage(StrictModel):
    page_number: int | None = Field(default=None, ge=1)
    section: str | None = None
    text: str = Field(min_length=1)


class PlanningExtractionProposal(StrictModel):
    id: str = Field(min_length=1)
    candidate_id: str = Field(min_length=1)
    claim: EvidenceClaim
    exact_excerpt: str = Field(min_length=1)
    explicit_statement: bool


class PlanningReviewTask(StrictModel):
    id: str = Field(min_length=1)
    entity_id: str = Field(min_length=1)
    reason: PlanningReviewReason
    severity: PlanningReviewSeverity
    summary: str = Field(min_length=1)


class PlanningEvidenceAdmissionRequest(StrictModel):
    candidate: PlanningDocumentCandidate
    source_document: SourceDocument
    plan_document: PlanDocument
    pages: list[PlanningDocumentPage] = Field(default_factory=list)
    proposals: list[PlanningExtractionProposal] = Field(default_factory=list)


class PlanningEvidenceAdmissionResult(StrictModel):
    candidate_id: str = Field(min_length=1)
    source_document_id: str = Field(min_length=1)
    plan_document_id: str = Field(min_length=1)
    accepted_claims: list[EvidenceClaim] = Field(default_factory=list)
    quarantined_claims: list[EvidenceClaim] = Field(default_factory=list)
    review_tasks: list[PlanningReviewTask] = Field(default_factory=list)
    ready_for_county_graph: bool = False
    public_eligibility: Literal[False] = False


def _normalize_text(value: str) -> str:
    return " ".join(value.split())


def _excerpt_hash(value: str) -> str:
    return f"sha256:{sha256(value.encode('utf-8')).hexdigest()}"


def _task(
    *,
    candidate_id: str,
    entity_id: str,
    reason: PlanningReviewReason,
    severity: PlanningReviewSeverity,
    summary: str,
) -> PlanningReviewTask:
    return PlanningReviewTask(
        id=f"planning-review:{candidate_id}:{entity_id}:{reason}",
        entity_id=entity_id,
        reason=reason,
        severity=severity,
        summary=summary,
    )


def _is_county_plan_designation(candidate: PlanningDocumentCandidate) -> bool:
    return (
        candidate.coverage_scope == "county_specific"
        and candidate.document_type in {"chip", "csp", "implementation_strategy"}
    )


def _find_page_text(
    pages: list[PlanningDocumentPage],
    *,
    page_number: int | None,
    section: str | None,
) -> str:
    if page_number is None and section is None:
        return ""
    matches = [
        page.text
        for page in pages
        if (page_number is None or page.page_number == page_number)
        and (section is None or page.section == section)
    ]
    return "\n".join(matches)


def admit_planning_evidence(
    request: PlanningEvidenceAdmissionRequest,
) -> PlanningEvidenceAdmissionResult:
    candidate = request.candidate
    source_document = request.source_document
    plan_document = request.plan_document

    accepted: list[EvidenceClaim] = []
    quarantined: list[EvidenceClaim] = []
    tasks: list[PlanningReviewTask] = []

    if plan_document.source_document_id != source_document.id:
        tasks.append(
            _task(
                candidate_id=candidate.id,
                entity_id=plan_document.id,
                reason="source_document_mismatch",
                severity="blocking",
                summary="Plan document does not reference the supplied source document.",
            )
        )

    if plan_document.document_type != candidate.document_type:
        tasks.append(
            _task(
                candidate_id=candidate.id,
                entity_id=plan_document.id,
                reason="document_scope_mismatch",
                severity="blocking",
                summary="Plan document type does not match the approved planning candidate classification.",
            )
        )

    candidate_geographies = set(candidate.covered_geography_ids)
    plan_geographies = set(plan_document.geography_ids)
    source_geographies = set(source_document.geography_ids)
    if not candidate_geographies.intersection(plan_geographies):
        tasks.append(
            _task(
                candidate_id=candidate.id,
                entity_id=plan_document.id,
                reason="document_scope_mismatch",
                severity="blocking",
                summary="Plan document geography does not overlap the approved candidate geography.",
            )
        )
    if source_geographies and not candidate_geographies.intersection(source_geographies):
        tasks.append(
            _task(
                candidate_id=candidate.id,
                entity_id=source_document.id,
                reason="document_scope_mismatch",
                severity="blocking",
                summary="Source document geography does not overlap the approved candidate geography.",
            )
        )

    if (
        source_document.review_status != ReviewStatus.VERIFIED
        or source_document.trust != DocumentTrust.OFFICIAL_VERIFIED
        or source_document.visibility != TenantVisibility.PUBLIC
    ):
        tasks.append(
            _task(
                candidate_id=candidate.id,
                entity_id=source_document.id,
                reason="document_not_verified",
                severity="blocking",
                summary="Source document must be verified, official, and public before its claims can enter county planning state.",
            )
        )

    if plan_document.review_status != ReviewStatus.VERIFIED:
        tasks.append(
            _task(
                candidate_id=candidate.id,
                entity_id=plan_document.id,
                reason="document_not_verified",
                severity="blocking",
                summary="Planning document classification requires formal verification before county-graph admission.",
            )
        )

    if candidate.coverage_scope != "county_specific" and plan_document.current_plan_status == "verified_current":
        tasks.append(
            _task(
                candidate_id=candidate.id,
                entity_id=plan_document.id,
                reason="current_plan_not_verified",
                severity="blocking",
                summary="Regional or hospital-specific evidence cannot be designated as the county's current plan.",
            )
        )
    elif _is_county_plan_designation(candidate) and plan_document.current_plan_status != "verified_current":
        tasks.append(
            _task(
                candidate_id=candidate.id,
                entity_id=plan_document.id,
                reason="current_plan_not_verified",
                severity="blocking",
                summary="County plan status must be explicitly verified before the document is treated as the current plan.",
            )
        )

    for proposal in request.proposals:
        claim = proposal.claim
        if proposal.candidate_id != candidate.id or claim.source_document_id != source_document.id:
            quarantined.append(claim)
            tasks.append(
                _task(
                    candidate_id=candidate.id,
                    entity_id=claim.id,
                    reason="claim_document_mismatch",
                    severity="review_required",
                    summary="Claim does not belong to the approved candidate and source document pair.",
                )
            )
            continue

        locator = claim.citation
        if locator.page_number is None and locator.section is None:
            quarantined.append(claim)
            tasks.append(
                _task(
                    candidate_id=candidate.id,
                    entity_id=claim.id,
                    reason="citation_locator_missing",
                    severity="review_required",
                    summary="Claim requires a page number or section locator.",
                )
            )
            continue

        page_text = _find_page_text(
            request.pages,
            page_number=locator.page_number,
            section=locator.section,
        )
        excerpt_matches = _normalize_text(proposal.exact_excerpt) in _normalize_text(page_text)
        hash_matches = (
            locator.quoted_text_hash is not None
            and locator.quoted_text_hash == _excerpt_hash(proposal.exact_excerpt)
        )
        if not excerpt_matches or not hash_matches:
            quarantined.append(claim)
            tasks.append(
                _task(
                    candidate_id=candidate.id,
                    entity_id=claim.id,
                    reason="citation_text_mismatch",
                    severity="review_required",
                    summary="The claimed excerpt does not match the cited page or its recorded excerpt hash.",
                )
            )
            continue

        if not proposal.explicit_statement:
            quarantined.append(claim)
            tasks.append(
                _task(
                    candidate_id=candidate.id,
                    entity_id=claim.id,
                    reason="claim_not_explicit",
                    severity="review_required",
                    summary="The source text does not explicitly support the proposed structured claim.",
                )
            )
            continue

        if claim.confidence == Confidence.LOW:
            quarantined.append(claim)
            tasks.append(
                _task(
                    candidate_id=candidate.id,
                    entity_id=claim.id,
                    reason="extraction_confidence_low",
                    severity="review_required",
                    summary="Low-confidence extraction is quarantined from county planning state.",
                )
            )
            continue

        accepted.append(claim)
        if claim.review_status != ReviewStatus.VERIFIED:
            tasks.append(
                _task(
                    candidate_id=candidate.id,
                    entity_id=claim.id,
                    reason="formal_verification_required",
                    severity="review_required",
                    summary="Citation matched, but the structured claim still requires named human verification.",
                )
            )

    blocking = any(item.severity == "blocking" for item in tasks)
    all_accepted_verified = bool(accepted) and all(
        item.review_status == ReviewStatus.VERIFIED for item in accepted
    )
    ready = not blocking and all_accepted_verified

    deduped_tasks = list({item.id: item for item in tasks}.values())
    return PlanningEvidenceAdmissionResult(
        candidate_id=candidate.id,
        source_document_id=source_document.id,
        plan_document_id=plan_document.id,
        accepted_claims=accepted,
        quarantined_claims=quarantined,
        review_tasks=deduped_tasks,
        ready_for_county_graph=ready,
        public_eligibility=False,
    )
