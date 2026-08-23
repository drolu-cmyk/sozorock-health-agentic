from datetime import datetime, timezone

import pytest

from cbcap_core.funding_decision import (
    FundingPursuitDecisionRequest,
    build_funding_pursuit_decision,
)
from cbcap_core.models import Confidence, FundingFit, ReviewStatus

NOW = datetime(2026, 8, 22, 23, 45, tzinfo=timezone.utc)


def reviewed_fit(*, eligibility="likely_eligible", missing=None, tenant_id="tenant-a") -> FundingFit:
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
        eligibility_status=eligibility,
        fit_status="strong",
        confidence=Confidence.HIGH,
        review_status=ReviewStatus.VERIFIED,
    )


def request(action="pursue", *, fit=None, unresolved=None) -> FundingPursuitDecisionRequest:
    return FundingPursuitDecisionRequest(
        funding_fit=fit or reviewed_fit(),
        actor_tenant_id="tenant-a",
        actor_id="planner@example.org",
        actor_role="planner",
        action=action,
        reason_codes=["strategic_priority_alignment"],
        rationale="The organization reviewed the funding fit and made a separate pursuit decision.",
        decided_at=NOW,
        required_partner_ids=["org:implementation-partner"],
        unresolved_requirement_ids=unresolved or [],
    )


def test_pursue_decision_is_separate_memory_from_fit_review():
    result = build_funding_pursuit_decision(request())
    assert result.action == "pursue"
    assert result.memory_proposal.subject_type == "funding_pursuit_decision"
    assert result.memory_proposal.subject_id == "funding:opp-1"
    assert result.memory_proposal.outcome == "accepted"
    assert "funding-fit:tenant-a:opp-1" in result.memory_proposal.evidence_entity_ids


def test_defer_preserves_missing_requirements_for_future_cycle():
    fit = reviewed_fit(missing=["county_match_letter"])
    result = build_funding_pursuit_decision(
        request("defer", fit=fit, unresolved=["implementation_partner_agreement"])
    )
    assert result.memory_proposal.outcome == "deferred"
    assert set(result.memory_proposal.missing_requirements) == {
        "county_match_letter",
        "implementation_partner_agreement",
    }


def test_cannot_pursue_reviewed_ineligible_fit():
    with pytest.raises(ValueError, match="ineligible"):
        build_funding_pursuit_decision(
            request("pursue", fit=reviewed_fit(eligibility="ineligible"))
        )


def test_cannot_pursue_while_unresolved_requirements_are_hidden():
    with pytest.raises(ValueError, match="unresolved"):
        build_funding_pursuit_decision(
            request("pursue", unresolved=["implementation_partner_agreement"])
        )


def test_unreviewed_fit_cannot_drive_organizational_decision():
    provisional = reviewed_fit().model_copy(update={"review_status": ReviewStatus.PROVISIONAL})
    with pytest.raises(ValueError, match="reviewed"):
        build_funding_pursuit_decision(request("defer", fit=provisional))


def test_cross_tenant_funding_decision_fails_closed():
    foreign = reviewed_fit(tenant_id="tenant-b")
    with pytest.raises(ValueError, match="tenant"):
        build_funding_pursuit_decision(request("defer", fit=foreign))
