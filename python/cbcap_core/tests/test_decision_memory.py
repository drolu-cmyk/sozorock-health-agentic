from datetime import datetime, timedelta, timezone

import pytest

from cbcap_core.decision_memory import (
    DecisionMemoryProposal,
    DecisionMemoryQuery,
    DecisionMemoryWriteRequest,
    build_decision_memory,
    query_decision_memory,
    supersede_decision_memory,
)

NOW = datetime(2026, 8, 22, 23, 0, tzinfo=timezone.utc)


def funding_rejection_proposal(*, tenant_id="tenant-a") -> DecisionMemoryProposal:
    return DecisionMemoryProposal(
        tenant_id=tenant_id,
        geography_id="county:36001",
        decision_type="funding_fit",
        subject_type="funding_opportunity",
        subject_id="funding:opp-1",
        outcome="rejected",
        reason_codes=["required_partner_missing", "implementation_capacity_gap"],
        rationale="The opportunity was not advanced because the required implementation partner was not in the approved county partner record.",
        evidence_entity_ids=["funding-fit:tenant-a:funding:opp-1", "priority:access"],
        related_entity_ids=["org:required-partner"],
        missing_requirements=["org:required-partner"],
        applicability="reusable",
    )


def write_request(*, role="reviewer", approve=True, tenant_id="tenant-a") -> DecisionMemoryWriteRequest:
    return DecisionMemoryWriteRequest(
        proposal=funding_rejection_proposal(tenant_id=tenant_id),
        actor_tenant_id=tenant_id,
        actor_id="reviewer@example.org",
        actor_role=role,
        decided_at=NOW,
        approve_as_reviewed=approve,
    )


def test_reviewer_can_promote_structured_funding_rejection_to_reviewed_memory():
    record = build_decision_memory(write_request())
    assert record.status == "reviewed"
    assert record.outcome == "rejected"
    assert record.missing_requirements == ["org:required-partner"]
    assert record.applicability == "reusable"


def test_analyst_cannot_create_reviewed_institutional_memory():
    with pytest.raises(ValueError, match="reviewer or admin"):
        build_decision_memory(write_request(role="analyst", approve=True))


def test_analyst_can_create_proposal_without_promoting_it_to_memory_of_record():
    record = build_decision_memory(write_request(role="analyst", approve=False))
    assert record.status == "proposed"


def test_cross_tenant_memory_write_fails_closed():
    request = write_request()
    request = request.model_copy(update={"actor_tenant_id": "tenant-b"})
    with pytest.raises(ValueError, match="tenant"):
        build_decision_memory(request)


def test_default_query_returns_reviewed_memory_of_record_only():
    reviewed = build_decision_memory(write_request())
    proposed = build_decision_memory(write_request(role="analyst", approve=False))
    proposed = proposed.model_copy(update={"id": "memory:proposed"})

    result = query_decision_memory(
        [proposed, reviewed],
        DecisionMemoryQuery(
            tenant_id="tenant-a",
            geography_id="county:36001",
            decision_type="funding_fit",
        ),
        actor_tenant_id="tenant-a",
        as_of=NOW + timedelta(days=1),
    )
    assert [item.id for item in result] == [reviewed.id]


def test_missing_partner_rejection_is_retrievable_in_future_planning_cycle():
    reviewed = build_decision_memory(write_request())
    result = query_decision_memory(
        [reviewed],
        DecisionMemoryQuery(
            tenant_id="tenant-a",
            geography_id="county:36001",
            subject_id="funding:opp-1",
        ),
        actor_tenant_id="tenant-a",
        as_of=NOW + timedelta(days=365),
    )
    assert len(result) == 1
    assert "required_partner_missing" in result[0].reason_codes
    assert result[0].missing_requirements == ["org:required-partner"]


def test_expired_memory_is_hidden_by_default():
    reviewed = build_decision_memory(write_request())
    expired = reviewed.model_copy(
        update={
            "id": "memory:expired",
            "expires_at": NOW + timedelta(days=1),
        }
    )
    result = query_decision_memory(
        [expired],
        DecisionMemoryQuery(tenant_id="tenant-a"),
        actor_tenant_id="tenant-a",
        as_of=NOW + timedelta(days=2),
    )
    assert result == []


def test_reviewer_can_supersede_memory_without_mutating_prior_record():
    reviewed = build_decision_memory(write_request())
    superseding = supersede_decision_memory(
        reviewed,
        actor_tenant_id="tenant-a",
        actor_id="reviewer-2@example.org",
        actor_role="reviewer",
        decided_at=NOW + timedelta(days=30),
        reason_code="partner_requirement_resolved",
        rationale="The required implementation partner is now under an approved collaboration agreement.",
    )
    assert reviewed.status == "reviewed"
    assert superseding.status == "superseded"
    assert superseding.supersedes_memory_id == reviewed.id
    assert superseding.expires_at == NOW + timedelta(days=30)
