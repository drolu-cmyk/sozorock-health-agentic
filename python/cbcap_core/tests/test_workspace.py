from datetime import datetime, timezone

import pytest

from cbcap_core.models import (
    BarrierFamily,
    BarrierObservation,
    Conflict,
    CountyRunState,
    GeographyKind,
    GeographyRef,
    ReviewStatus,
    WorkflowFlags,
)
from cbcap_core.workspace import DecisionWorkspaceRequest, build_decision_workspace

NOW = datetime(2026, 8, 22, 22, 30, tzinfo=timezone.utc)


def county() -> GeographyRef:
    return GeographyRef(
        id="county:36001",
        kind=GeographyKind.COUNTY,
        authority="census",
        authority_id="36001",
        name="Albany County",
        display_name="Albany County, New York",
        state_fips="36",
        county_fips="36001",
        vintage="2025",
        review_status=ReviewStatus.VERIFIED,
    )


def barrier(barrier_id: str, family: BarrierFamily, status: ReviewStatus) -> BarrierObservation:
    return BarrierObservation(
        id=barrier_id,
        barrier_family=family,
        geography=county(),
        measure_id=f"measure:{barrier_id}",
        observed_value=12.0,
        pressure_percentile=80.0,
        evidence_quality="high" if status == ReviewStatus.VERIFIED else "moderate",
        review_status=status,
    )


def run(*, tenant_id="tenant-a", safe=False, provisional=False, conflict=False) -> CountyRunState:
    flags = WorkflowFlags()
    if safe:
        flags = WorkflowFlags(
            geography_verified=True,
            required_sources_complete=True,
            evidence_validated=True,
            policy_passed=True,
            safe_to_publish=True,
        )
    conflicts = []
    if conflict:
        conflicts = [
            Conflict(
                id="conflict:1",
                geography_id=county().id,
                entity_type="evidence",
                entity_ids=["evidence:1", "evidence:2"],
                conflict_type="source_disagreement",
                summary="Controlled source disagreement.",
                blocking=True,
                review_status=ReviewStatus.PROVISIONAL,
            )
        ]
    barriers = [
        barrier("transportation", BarrierFamily.TRANSPORTATION_TRAVEL, ReviewStatus.VERIFIED),
        barrier("housing", BarrierFamily.HOUSING, ReviewStatus.VERIFIED),
    ]
    if provisional:
        barriers.append(
            barrier("food", BarrierFamily.FOOD_SECURITY, ReviewStatus.PROVISIONAL)
        )
    return CountyRunState(
        run_id="workspace-run",
        tenant_id=tenant_id,
        county=county(),
        requested_at=NOW,
        flags=flags,
        barrier_observations=barriers,
        conflicts=conflicts,
    )


def request(county_run: CountyRunState, *, role="analyst", actor_tenant_id="tenant-a"):
    return DecisionWorkspaceRequest(
        county_run=county_run,
        question="which_barriers_overlap",
        role=role,
        actor_tenant_id=actor_tenant_id,
    )


def test_workspace_uses_verified_barriers_for_authoritative_matrix():
    workspace = build_decision_workspace(request(run()))
    assert workspace.view.status == "ready"
    assert workspace.view.kind == "barrier_matrix"
    assert set(workspace.authoritative_entity_ids) == {"transportation", "housing"}
    assert workspace.evidence_status.verified_barriers == 2


def test_provisional_evidence_is_visible_but_not_authoritative():
    workspace = build_decision_workspace(request(run(provisional=True)))
    assert workspace.evidence_status.provisional_barriers == 1
    assert "food" not in workspace.authoritative_entity_ids
    assert any(item.code == "provisional_evidence" for item in workspace.blockers)
    assert workspace.publication_state == "review_required"
    assert "request_review" in workspace.allowed_actions


def test_read_only_role_cannot_export_or_change_planning_state():
    workspace = build_decision_workspace(request(run(), role="read_only"))
    assert workspace.allowed_actions == ["inspect_evidence"]


def test_reviewer_can_resolve_blocking_conflict_but_cannot_auto_publish_it():
    workspace = build_decision_workspace(request(run(conflict=True), role="reviewer"))
    assert "review_conflicts" in workspace.allowed_actions
    assert "approve_publication" not in workspace.allowed_actions
    assert workspace.publication_state == "review_required"


def test_reviewer_can_approve_only_after_run_is_safe_to_publish():
    workspace = build_decision_workspace(request(run(safe=True), role="reviewer"))
    assert workspace.publication_state == "safe_not_approved"
    assert "approve_publication" in workspace.allowed_actions


def test_cross_tenant_workspace_access_fails_closed():
    with pytest.raises(ValueError, match="tenant"):
        build_decision_workspace(
            request(run(tenant_id="tenant-a"), actor_tenant_id="tenant-b")
        )
