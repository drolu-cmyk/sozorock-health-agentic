from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.funding_decision import (
    FundingPursuitDecisionRequest,
    build_funding_pursuit_decision,
)
from cbcap_core.models import Confidence, FundingFit, ReviewStatus

ISSUED = datetime(2026, 1, 1, tzinfo=timezone.utc)
EXPIRES = datetime(2099, 1, 1, tzinfo=timezone.utc)
TENANT = "tenant-a"
COUNTY = "county:36001"


def actor(
    *,
    role="planner",
    tenant_id=TENANT,
    actor_id=None,
    capabilities=None,
    geography_ids=None,
) -> AuthorizedActor:
    principal = actor_id or f"principal:{role}"
    grant = AuthorizationGrant(
        grant_id=f"grant:{principal}",
        actor_id=principal,
        tenant_id=tenant_id,
        capabilities=capabilities or sorted(ROLE_CAPABILITIES[role]),
        geography_ids=geography_ids if geography_ids is not None else [COUNTY],
        run_ids=[],
        issuer="test-identity-verifier",
        issued_at=ISSUED,
        expires_at=EXPIRES,
    )
    return AuthorizedActor(
        actor_id=principal,
        tenant_id=tenant_id,
        role=role,
        authorization=grant,
    )


def reviewed_fit(*, eligibility="likely_eligible", missing=None, tenant_id=TENANT) -> FundingFit:
    return FundingFit(
        id="funding-fit:tenant-a:opp-1",
        opportunity_id="funding:opp-1",
        tenant_id=tenant_id,
        geography_id=COUNTY,
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
        action=action,
        reason_codes=["strategic_priority_alignment"],
        rationale="The organization reviewed the funding fit and made a separate pursuit decision.",
        required_partner_ids=["org:implementation-partner"],
        unresolved_requirement_ids=unresolved or [],
    )


def test_pursuit_payload_cannot_supply_actor_tenant_role_or_timestamp():
    payload = request().model_dump(mode="python")
    payload.update(
        {
            "actor_tenant_id": TENANT,
            "actor_id": "impersonated:planner",
            "actor_role": "admin",
            "decided_at": ISSUED,
        }
    )
    with pytest.raises(ValidationError):
        FundingPursuitDecisionRequest.model_validate(payload)


def test_pursue_decision_is_separate_memory_from_fit_review_and_identity_is_trusted():
    planner = actor(actor_id="principal:planner-7")
    result = build_funding_pursuit_decision(request(), actor=planner)
    assert result.action == "pursue"
    assert result.decided_by == planner.actor_id
    assert result.decided_at.tzinfo is not None
    assert result.memory_proposal.subject_type == "funding_pursuit_decision"
    assert result.memory_proposal.subject_id == "funding:opp-1"
    assert result.memory_proposal.outcome == "accepted"
    assert "funding-fit:tenant-a:opp-1" in result.memory_proposal.evidence_entity_ids


def test_defer_preserves_missing_requirements_for_future_cycle():
    fit = reviewed_fit(missing=["county_match_letter"])
    result = build_funding_pursuit_decision(
        request("defer", fit=fit, unresolved=["implementation_partner_agreement"]),
        actor=actor(),
    )
    assert result.memory_proposal.outcome == "deferred"
    assert set(result.memory_proposal.missing_requirements) == {
        "county_match_letter",
        "implementation_partner_agreement",
    }


def test_cannot_pursue_reviewed_ineligible_fit():
    with pytest.raises(ValueError, match="ineligible"):
        build_funding_pursuit_decision(
            request("pursue", fit=reviewed_fit(eligibility="ineligible")),
            actor=actor(),
        )


def test_cannot_pursue_while_explicit_unresolved_requirements_are_hidden():
    with pytest.raises(ValueError, match="unresolved"):
        build_funding_pursuit_decision(
            request("pursue", unresolved=["implementation_partner_agreement"]),
            actor=actor(),
        )


def test_unreviewed_fit_cannot_drive_organizational_decision():
    provisional = reviewed_fit().model_copy(update={"review_status": ReviewStatus.PROVISIONAL})
    with pytest.raises(ValueError, match="reviewed"):
        build_funding_pursuit_decision(
            request("defer", fit=provisional),
            actor=actor(),
        )


def test_pursuit_requires_explicit_capability_and_geography_scope():
    with pytest.raises(PermissionError, match="decide_funding_pursuit"):
        build_funding_pursuit_decision(
            request("defer"),
            actor=actor(
                role="planner",
                capabilities=["read_workspace", "execute_county_run"],
            ),
        )

    with pytest.raises(PermissionError, match="geography"):
        build_funding_pursuit_decision(
            request("defer"),
            actor=actor(geography_ids=["county:42029"]),
        )


def test_analyst_cannot_escalate_to_funding_pursuit_capability():
    normal_analyst = actor(role="analyst")
    with pytest.raises(PermissionError, match="decide_funding_pursuit"):
        build_funding_pursuit_decision(request("defer"), actor=normal_analyst)

    with pytest.raises(ValidationError, match="exceeds role capabilities"):
        actor(role="analyst", capabilities=["decide_funding_pursuit"])


def test_cross_tenant_funding_decision_fails_closed():
    foreign = reviewed_fit(tenant_id="tenant-b")
    with pytest.raises(ValueError, match="tenant"):
        build_funding_pursuit_decision(
            request("defer", fit=foreign),
            actor=actor(),
        )


def test_pursuit_requires_reviewed_fit_evidence_chain():
    unsupported = reviewed_fit().model_copy(
        update={
            "plan_priority_ids": [],
            "barrier_observation_ids": [],
            "designation_evidence_claim_ids": [],
            "supporting_evidence_claim_ids": [],
        }
    )
    with pytest.raises(ValueError, match="evidence chain"):
        build_funding_pursuit_decision(
            request("defer", fit=unsupported),
            actor=actor(),
        )
