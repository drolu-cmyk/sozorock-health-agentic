from datetime import datetime, timezone

import pytest

from cbcap_core.funding_review import apply_funding_fit_review
from cbcap_core.models import (
    Confidence,
    FundingFit,
    ReviewDecision,
    ReviewStatus,
)

NOW = datetime(2026, 8, 22, 23, 30, tzinfo=timezone.utc)


def fit(*, tenant_id="tenant-a", missing=None) -> FundingFit:
    return FundingFit(
        id="funding-fit:tenant-a:opp-1",
        opportunity_id="funding:opp-1",
        tenant_id=tenant_id,
        geography_id="county:36001",
        plan_priority_ids=["priority:access"],
        barrier_observation_ids=["barrier:transportation"],
        designation_evidence_claim_ids=["claim:hpsa"],
        supporting_evidence_claim_ids=["claim:chip-priority"],
        missing_evidence=missing or [],
        eligibility_status="likely_eligible",
        fit_status="strong" if not missing else "weak",
        confidence=Confidence.HIGH,
        review_status=ReviewStatus.PROVISIONAL,
    )


def review(decision="approved", *, tenant_id="tenant-a", entity_id="funding-fit:tenant-a:opp-1") -> ReviewDecision:
    return ReviewDecision(
        id=f"review:{decision}:1",
        tenant_id=tenant_id,
        entity_type="funding_fit",
        entity_id=entity_id,
        decision=decision,
        decided_by="reviewer@example.org",
        decided_at=NOW,
        reason="Reviewed against the official opportunity requirements and county evidence.",
    )


def test_approved_review_verifies_fit_but_does_not_claim_organization_will_apply():
    result = apply_funding_fit_review(fit(), review(), actor_tenant_id="tenant-a")
    assert result.funding_fit.review_status == ReviewStatus.VERIFIED
    assert result.assessment_state == "verified"
    assert result.memory_proposal.outcome == "accepted"
    assert "does not represent a decision to pursue" in result.memory_proposal.rationale
    assert "funding:opp-1" in result.memory_proposal.related_entity_ids


def test_rejected_review_rejects_assessment_record_without_rewriting_evidence():
    result = apply_funding_fit_review(
        fit(),
        review("rejected"),
        actor_tenant_id="tenant-a",
    )
    assert result.funding_fit.review_status == ReviewStatus.REJECTED
    assert result.memory_proposal.outcome == "rejected"
    assert "claim:chip-priority" in result.memory_proposal.evidence_entity_ids


def test_needs_revision_keeps_funding_fit_provisional():
    result = apply_funding_fit_review(
        fit(missing=["required_partner"]),
        review("needs_revision"),
        actor_tenant_id="tenant-a",
    )
    assert result.funding_fit.review_status == ReviewStatus.PROVISIONAL
    assert result.assessment_state == "needs_revision"
    assert result.memory_proposal.missing_requirements == ["required_partner"]


def test_cross_tenant_review_fails_closed():
    with pytest.raises(ValueError, match="tenant"):
        apply_funding_fit_review(
            fit(),
            review(tenant_id="tenant-b"),
            actor_tenant_id="tenant-a",
        )


def test_review_must_reference_exact_funding_fit():
    with pytest.raises(ValueError, match="does not reference"):
        apply_funding_fit_review(
            fit(),
            review(entity_id="funding-fit:other"),
            actor_tenant_id="tenant-a",
        )


def test_reviewed_fit_without_supporting_evidence_ids_is_rejected():
    unsupported = fit().model_copy(
        update={
            "plan_priority_ids": [],
            "barrier_observation_ids": [],
            "designation_evidence_claim_ids": [],
            "supporting_evidence_claim_ids": [],
        }
    )
    with pytest.raises(ValueError, match="supporting evidence"):
        apply_funding_fit_review(
            unsupported,
            review(),
            actor_tenant_id="tenant-a",
        )
