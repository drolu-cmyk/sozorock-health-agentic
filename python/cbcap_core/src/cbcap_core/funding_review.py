from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from typing import Literal

from pydantic import Field

from .authorization import AuthorizedActor, require_actor_capability
from .decision_memory import DecisionMemoryProposal
from .models import FundingFit, ReviewDecision, ReviewStatus, StrictModel

FundingReviewAction = Literal["approved", "rejected", "needs_revision", "deferred"]


class FundingFitReviewRequest(StrictModel):
    """Review intent only. Reviewer identity, tenant and decision time are trusted service data."""

    funding_fit: FundingFit
    decision: FundingReviewAction
    reason: str = Field(min_length=1)


class FundingFitReviewResult(StrictModel):
    funding_fit: FundingFit
    review_decision: ReviewDecision
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


def _review_id(
    fit: FundingFit,
    actor: AuthorizedActor,
    request: FundingFitReviewRequest,
    decided_at: datetime,
) -> str:
    identity = "|".join(
        [
            fit.id,
            fit.tenant_id,
            fit.geography_id,
            actor.actor_id,
            request.decision,
            request.reason,
            decided_at.isoformat(),
        ]
    )
    return f"review:funding-fit:{sha256(identity.encode('utf-8')).hexdigest()}"


def apply_funding_fit_review(
    request: FundingFitReviewRequest,
    *,
    actor: AuthorizedActor,
) -> FundingFitReviewResult:
    """Apply governed review to a funding-fit assessment without deciding pursuit.

    Approval means the fit assessment itself is accepted as reviewed evidence.
    It never means the organization has decided to apply for the opportunity.
    Reviewer identity, tenant and time come from the authenticated service
    boundary rather than from the decision payload.
    """

    fit = request.funding_fit
    if fit.tenant_id != actor.tenant_id:
        raise ValueError("funding fit tenant does not match authenticated actor tenant")
    require_actor_capability(
        actor,
        "review_funding_fit",
        geography_id=fit.geography_id,
    )

    evidence_ids = list(
        dict.fromkeys(
            [
                *fit.supporting_evidence_claim_ids,
                *fit.designation_evidence_claim_ids,
                *fit.plan_priority_ids,
                *fit.barrier_observation_ids,
            ]
        )
    )
    if not evidence_ids:
        raise ValueError("reviewed funding fit must retain supporting evidence entity IDs")

    decided_at = datetime.now(timezone.utc)
    review = ReviewDecision(
        id=_review_id(fit, actor, request, decided_at),
        tenant_id=fit.tenant_id,
        entity_type="funding_fit",
        entity_id=fit.id,
        decision=request.decision,
        decided_by=actor.actor_id,
        decided_at=decided_at,
        reason=request.reason,
    )

    review_map = {
        "approved": (ReviewStatus.VERIFIED, "verified", "accepted"),
        "rejected": (ReviewStatus.REJECTED, "rejected", "rejected"),
        "needs_revision": (ReviewStatus.PROVISIONAL, "needs_revision", "needs_revision"),
        "deferred": (ReviewStatus.PROVISIONAL, "deferred", "deferred"),
    }
    target_review_status, assessment_state, memory_outcome = review_map[review.decision]
    reviewed_fit = fit.model_copy(update={"review_status": target_review_status})

    memory = DecisionMemoryProposal(
        tenant_id=fit.tenant_id,
        geography_id=fit.geography_id,
        decision_type="funding_fit",
        subject_type="funding_fit_assessment",
        subject_id=fit.id,
        outcome=memory_outcome,
        reason_codes=[*_fit_reason_codes(fit), f"review:{review.decision}"],
        rationale=(
            "Funding-fit assessment review: "
            + review.reason
            + " This records the assessment review only and does not represent a decision to pursue or decline the funding opportunity."
        ),
        evidence_entity_ids=evidence_ids,
        related_entity_ids=[fit.opportunity_id, review.id],
        missing_requirements=list(fit.missing_evidence),
        applicability="reusable",
    )

    return FundingFitReviewResult(
        funding_fit=reviewed_fit,
        review_decision=review,
        assessment_state=assessment_state,
        memory_proposal=memory,
    )
