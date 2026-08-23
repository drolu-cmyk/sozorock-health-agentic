from datetime import date, datetime, timezone

import pytest

from cbcap_core.models import (
    BarrierFamily,
    BarrierObservation,
    CountyRunState,
    GeographyKind,
    GeographyRef,
    Measure,
    MetricSemantics,
    ReviewStatus,
    SourceVersionRef,
    WorkflowFlags,
)
from cbcap_core.workspace_decisions import (
    WorkspaceDecisionRequest,
    prepare_workspace_decision,
    record_workspace_decision,
)

NOW = datetime(2026, 8, 22, 23, 55, tzinfo=timezone.utc)
TENANT = "tenant:albany-planning"


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


def source() -> SourceVersionRef:
    return SourceVersionRef(
        source_id="cdc-places",
        source_version_id="cdc-places:2026",
        publisher="Centers for Disease Control and Prevention",
        title="PLACES",
        official_url="https://www.cdc.gov/places/",
        release_label="2026",
        release_date=date(2026, 8, 1),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="places.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def measure(measure_id: str, *, status: ReviewStatus = ReviewStatus.VERIFIED) -> Measure:
    semantics = MetricSemantics(
        id=f"metric:{measure_id}",
        source_measure_id=measure_id.upper(),
        name=measure_id.title(),
        description="Controlled workspace decision test metric.",
        direction="adverse",
        higher_value_meaning="adverse",
        unit="percent",
        universe="adults",
        adjustment="modeled",
        comparison_policy="higher_is_concern",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )
    return Measure(
        id=f"measure:{measure_id}",
        semantics=semantics,
        geography=county(),
        source_version=source(),
        geography_level="county",
        value=12.0,
        numeric_value=12.0,
        review_status=status,
    )


def barrier(
    barrier_id: str,
    family: BarrierFamily,
    *,
    status: ReviewStatus = ReviewStatus.VERIFIED,
) -> BarrierObservation:
    return BarrierObservation(
        id=f"barrier:{barrier_id}",
        barrier_family=family,
        geography=county(),
        measure_id=f"measure:{barrier_id}",
        observed_value=12.0,
        evidence_quality="high" if status == ReviewStatus.VERIFIED else "moderate",
        review_status=status,
    )


def run(*, tenant_id: str | None = TENANT, safe: bool = False, provisional: bool = False) -> CountyRunState:
    flags = WorkflowFlags()
    if safe:
        flags = WorkflowFlags(
            geography_verified=True,
            required_sources_complete=True,
            evidence_validated=True,
            policy_passed=True,
            safe_to_publish=True,
        )
    measures = [measure("transportation"), measure("housing")]
    barriers = [
        barrier("transportation", BarrierFamily.TRANSPORTATION_TRAVEL),
        barrier("housing", BarrierFamily.HOUSING),
    ]
    if provisional:
        measures.append(measure("food", status=ReviewStatus.PROVISIONAL))
        barriers.append(
            barrier("food", BarrierFamily.FOOD_SECURITY, status=ReviewStatus.PROVISIONAL)
        )
    return CountyRunState(
        run_id="workspace-decision-run",
        tenant_id=tenant_id,
        county=county(),
        requested_at=NOW,
        flags=flags,
        measures=measures,
        barrier_observations=barriers,
    )


def decision_request(
    county_run: CountyRunState,
    *,
    role="analyst",
    decision_type="planning_interpretation",
    subject_id="barrier:transportation",
    outcome="accepted",
    evidence_entity_ids=None,
    approve_as_reviewed=False,
) -> WorkspaceDecisionRequest:
    return WorkspaceDecisionRequest(
        county_run=county_run,
        question="which_barriers_overlap",
        actor_tenant_id=TENANT,
        actor_id=f"actor:{role}",
        actor_role=role,
        decision_type=decision_type,
        subject_type="planning_entity",
        subject_id=subject_id,
        outcome=outcome,
        reason_codes=["controlled_test_decision"],
        rationale="Controlled decision-memory service test.",
        evidence_entity_ids=evidence_entity_ids or ["measure:transportation"],
        related_entity_ids=[],
        missing_requirements=[],
        applicability="reusable",
        decided_at=NOW,
        approve_as_reviewed=approve_as_reviewed,
    )


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        self.connection.executions.append((" ".join(query.split()), params))


class FakeConnection:
    def __init__(self):
        self.executions = []

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        pass

    def rollback(self):
        pass


def test_analyst_can_propose_but_not_promote_workspace_interpretation_to_memory_of_record():
    proposed = prepare_workspace_decision(decision_request(run()))
    assert proposed.memory.status == "proposed"
    assert proposed.memory.tenant_id == TENANT
    assert proposed.memory.subject_id == "barrier:transportation"

    with pytest.raises(ValueError, match="reviewer or admin"):
        prepare_workspace_decision(
            decision_request(run(), approve_as_reviewed=True)
        )


def test_reviewer_can_record_reviewed_interpretation_only_with_governed_evidence_lineage():
    reviewed = prepare_workspace_decision(
        decision_request(run(), role="reviewer", approve_as_reviewed=True)
    )
    assert reviewed.memory.status == "reviewed"
    assert "measure:transportation" in reviewed.workspace.authoritative_entity_ids

    with pytest.raises(ValueError, match="outside governed lineage"):
        prepare_workspace_decision(
            decision_request(
                run(provisional=True),
                role="reviewer",
                evidence_entity_ids=["barrier:food"],
                approve_as_reviewed=True,
            )
        )


def test_evidence_correction_can_target_provisional_entity_but_must_cite_authoritative_support():
    corrected = prepare_workspace_decision(
        decision_request(
            run(provisional=True),
            role="reviewer",
            decision_type="evidence_correction",
            subject_id="barrier:food",
            evidence_entity_ids=["measure:transportation"],
            approve_as_reviewed=True,
        )
    )
    assert corrected.memory.status == "reviewed"
    assert corrected.memory.subject_id == "barrier:food"
    assert corrected.memory.evidence_entity_ids == ["measure:transportation"]


def test_subject_related_entity_and_tenant_boundaries_fail_closed():
    with pytest.raises(ValueError, match="subject"):
        prepare_workspace_decision(
            decision_request(run(), subject_id="barrier:not-in-run")
        )

    bad_related = decision_request(run()).model_copy(
        update={"related_entity_ids": ["entity:other-county"]}
    )
    with pytest.raises(ValueError, match="related entities"):
        prepare_workspace_decision(bad_related)

    with pytest.raises(ValueError, match="tenant-scoped"):
        prepare_workspace_decision(decision_request(run(tenant_id=None)))

    cross_tenant = decision_request(run()).model_copy(
        update={"actor_tenant_id": "tenant:other"}
    )
    with pytest.raises(ValueError, match="tenant"):
        prepare_workspace_decision(cross_tenant)


def test_publication_acceptance_requires_reviewer_and_safe_not_approved_workspace_state():
    unsafe_request = decision_request(
        run(),
        role="reviewer",
        decision_type="publication_decision",
        subject_id="workspace-decision-run",
        approve_as_reviewed=True,
    )
    with pytest.raises(ValueError, match="publication approval"):
        prepare_workspace_decision(unsafe_request)

    safe_request = decision_request(
        run(safe=True),
        role="reviewer",
        decision_type="publication_decision",
        subject_id="workspace-decision-run",
        approve_as_reviewed=True,
    )
    approved = prepare_workspace_decision(safe_request)
    assert approved.workspace.publication_state == "safe_not_approved"
    assert "approve_publication" in approved.workspace.allowed_actions
    assert approved.memory.decision_type == "publication_decision"
    assert approved.memory.status == "reviewed"


def test_publication_rejection_can_cite_governed_blocker_but_still_requires_reviewer():
    blocked_run = run(provisional=True)
    request = decision_request(
        blocked_run,
        role="reviewer",
        decision_type="publication_decision",
        subject_id="workspace-decision-run",
        outcome="rejected",
        evidence_entity_ids=["barrier:food"],
        approve_as_reviewed=True,
    )
    rejected = prepare_workspace_decision(request)
    assert rejected.workspace.publication_state == "review_required"
    assert rejected.memory.outcome == "rejected"

    with pytest.raises(ValueError, match="reviewer or admin"):
        prepare_workspace_decision(
            request.model_copy(update={"actor_role": "analyst"})
        )


def test_record_workspace_decision_persists_rebuilt_governed_memory():
    connection = FakeConnection()
    result = record_workspace_decision(
        connection,
        decision_request(run(), role="reviewer", approve_as_reviewed=True),
    )
    assert result.memory.status == "reviewed"
    assert connection.executions[0][1] == (TENANT,)
    assert "INSERT INTO cbcap.decision_memory" in connection.executions[1][0]
