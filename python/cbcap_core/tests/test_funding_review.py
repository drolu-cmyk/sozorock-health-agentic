from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.funding_review import FundingFitReviewRequest, apply_funding_fit_review
from cbcap_core.models import Confidence, FundingFit, ReviewStatus

ISSUED = datetime(2026, 1, 1, tzinfo=timezone.utc)
EXPIRES = datetime(2099, 1, 1, tzinfo=timezone.utc)
TENANT = "tenant-a"
COUNTY = "county:36001"


def actor(
    *,
    role="reviewer",
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


def fit(*, tenant_id=TENANT, missing=None) -> FundingFit:
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
        eligibility_status="likely_eligible",
        fit_status="strong" if not missing else "weak",
        confidence=Confidence.HIGH,
        review_status=ReviewStatus.PROVISIONAL,
    )


def request(decision="approved", *, funding_fit=None) -> FundingFitReviewRequest:
    return FundingFitReviewRequest(
        funding_fit=funding_fit or fit(),
        decision=decision,
        reason="Reviewed against the official opportunity requirements and county evidence.",
    )


def test_review_payload_cannot_supply_reviewer_identity_tenant_or_timestamp():
    payload = request().model_dump(mode="python")
    payload.update(
        {
            "actor_id": "impersonated:reviewer",
            "actor_tenant_id": TENANT,
            "actor_role": "reviewer",
            "decided_at": ISSUED,
        }
    )
    with pytest.raises(ValidationError):
        FundingFitReviewRequest.model_validate(payload)


def test_approved_review_verifies_fit_but_does_not_claim_organization_will_apply():
    reviewer = actor(actor_id="principal:reviewer-42")
    result = apply_funding_fit_review(request(), actor=reviewer)
    assert result.funding_fit.review_status == ReviewStatus.VERIFIED
    assert result.assessment_state == "verified"
    assert result.review_decision.decided_by == reviewer.actor_id
    assert result.review_decision.tenant_id == TENANT
    assert result.review_decision.entity_id == fit().id
    assert result.memory_proposal.outcome == "accepted"
    assert "does not represent a decision to pursue" in result.memory_proposal.rationale
    assert result.review_decision.id in result.memory_proposal.related_entity_ids
    assert "funding:opp-1" in result.memory_proposal.related_entity_ids


def test_rejected_review_rejects_assessment_record_without_rewriting_evidence():
    result = apply_funding_fit_review(request("rejected"), actor=actor())
    assert result.funding_fit.review_status == ReviewStatus.REJECTED
    assert result.review_decision.decision == "rejected"
    assert result.memory_proposal.outcome == "rejected"
    assert "claim:chip-priority" in result.memory_proposal.evidence_entity_ids


def test_needs_revision_keeps_funding_fit_provisional_and_preserves_gaps():
    result = apply_funding_fit_review(
        request("needs_revision", funding_fit=fit(missing=["required_partner"])),
        actor=actor(),
    )
    assert result.funding_fit.review_status == ReviewStatus.PROVISIONAL
    assert result.assessment_state == "needs_revision"
    assert result.memory_proposal.missing_requirements == ["required_partner"]


def test_only_explicit_review_capability_can_review_funding_fit():
    with pytest.raises(PermissionError, match="review_funding_fit"):
        apply_funding_fit_review(
            request(),
            actor=actor(
                role="reviewer",
                capabilities=[
                    "read_workspace",
                    "record_workspace_review",
                ],
            ),
        )

    with pytest.raises(ValidationError, match="exceeds role capabilities"):
        actor(
            role="planner",
            capabilities=["review_funding_fit"],
        )


def test_cross_tenant_and_cross_county_funding_review_fail_closed():
    with pytest.raises(ValueError, match="tenant"):
        apply_funding_fit_review(
            request(),
            actor=actor(tenant_id="tenant-b"),
        )

    with pytest.raises(PermissionError, match="geography"):
        apply_funding_fit_review(
            request(),
            actor=actor(geography_ids=["county:42029"]),
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
            request(funding_fit=unsupported),
            actor=actor(),
        )
