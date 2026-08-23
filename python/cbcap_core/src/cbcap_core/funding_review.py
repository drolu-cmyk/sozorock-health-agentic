from __future__ import annotations

from typing import Literal

from pydantic import Field

from .decision_memory import DecisionMemoryProposal
from .models import FundingFit, ReviewDecision, ReviewStatus, StrictModel


class FundingFitReviewResult(StrictModel):
    funding_fit: FundingFit
    review_decision_id: str = Field(min_length=1)
    assessment_state: Literal["verified", "rejected", "needs_revision", "deferred"]
    memory_proposal: DecisionMemoryProposal


def _fit_reason_codes(fit: FundingFit) -> list[str]:
    reasons = [
        f"eligibility:{fit.eligibility_status}",
        f"fit:{fit.fit_status}",
        f"confidence:{fit.confidence.value}",
    ]
    if fit.missing_evidence:
        reasons.append("missing_evidence")
    return reasons


def apply_funding_fit_review(
    fit: FundingFit,
    review: ReviewDecision,
    *,
    actor_tenant_id: str,
) -> FundingFitReviewResult:
    """Apply human review to a funding-fit assessment without deciding pursuit.

    Approval means the fit assessment itself is accepted as reviewed evidence.
    It does not mean the organization has decided to apply for the opportunity.
    A separate organizational decision can later reference this reviewed memory.
    """

    if fit.tenant_id != actor_tenant_id:
        raise ValueError("funding fit tenant does not match authenticated actor tenant")
    if review.tenant_id is not None and review.tenant_id != fit.tenant_id:
        raise ValueError("funding review tenant does not match funding fit tenant")
    if review.entity_type != "funding_fit" or review.entity_id != fit.id:
        raise ValueError("review decision does not reference the funding fit")

    review_map = {
        "approved": (ReviewStatus.VERIFIED, "verified", "accepted"),
        "rejected": (ReviewStatus.REJECTED, "rejected", "rejected"),
        "needs_revision": (ReviewStatus.PROVISIONAL, "needs_revision", "needs_revision"),
        "deferred": (ReviewStatus.PROVISIONAL, "deferred", "deferred"),
    }
    target_review_status, assessment_state, memory_outcome = review_map[review.decision]
    reviewed_fit = fit.model_copy(update={"review_status": target_review_status})

    evidence_ids = list(dict.fromkeys([
        *fit.supporting_evidence_claim_ids,
        *fit.designation_evidence_claim_ids,
        *fit.plan_priority_ids,
        *fit.barrier_observation_ids,
    ]))
    if not evidence_ids:
        raise ValueError("reviewed funding fit must retain supporting evidence entity IDs")

    memory = DecisionMemoryProposal(
        tenant_id=fit.tenant_id,
        geography_id=fit.geography_id,
        decision_type="funding_fit",
        subject_type="funding_fit_assessment",
        subject_id=fit.id,
        outcome=memory_outcome,
        reason_codes=[*_fit_reason_codes(fit), f"review:{review.decision}"],
        rationale=(
            "Funding-fit assessment review: " + review.reason
            + " This records the assessment review only and does not represent a decision to pursue or decline the funding opportunity."
        ),
        evidence_entity_ids=evidence_ids,
        related_entity_ids=[fit.opportunity_id, review.id],
        missing_requirements=list(fit.missing_evidence),
        applicability="reusable",
    )

    return FundingFitReviewResult(
        funding_fit=reviewed_fit,
        review_decision_id=review.id,
        assessment_state=assessment_state,
        memory_proposal=memory,
    )
