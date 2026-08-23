from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

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
)
from cbcap_core.runtime_service import RuntimeActor
from cbcap_core.workspace_decisions import (
    WorkspaceDecisionRequest,
    prepare_workspace_decision,
    record_workspace_decision,
)

NOW = datetime(2026, 8, 22, 23, 55, tzinfo=timezone.utc)
TENANT = "tenant:albany-planning"


def actor(*, role="analyst", tenant_id=TENANT, actor_id=None) -> RuntimeActor:
    return RuntimeActor(
        actor_id=actor_id or f"principal:{role}",
        tenant_id=tenant_id,
        role=role,
    )


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


def run(*, tenant_id: str | None = TENANT, provisional: bool = False) -> CountyRunState:
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
        measures=measures,
        barrier_observations=barriers,
    )


def decision_request(
    county_run: CountyRunState,
    *,
    action="compare_barriers",
    decision_type="planning_interpretation",
    subject_id="barrier:transportation",
    outcome="accepted",
    evidence_entity_ids=None,
) -> WorkspaceDecisionRequest:
    return WorkspaceDecisionRequest(
        county_run=county_run,
        question="which_barriers_overlap",
        action=action,
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


def test_caller_cannot_supply_actor_review_status_or_decision_timestamp():
    payload = decision_request(run()).model_dump(mode="python")
    payload.update(
        {
            "actor_id": "impersonated:reviewer",
            "actor_tenant_id": TENANT,
            "actor_role": "reviewer",
            "approve_as_reviewed": True,
            "decided_at": NOW,
        }
    )
    with pytest.raises(ValidationError):
        WorkspaceDecisionRequest.model_validate(payload)


def test_analyst_decision_is_proposed_and_identity_comes_from_runtime_actor():
    result = prepare_workspace_decision(
        decision_request(run()),
        actor=actor(role="analyst", actor_id="principal:analyst-7"),
    )
    assert result.memory.status == "proposed"
    assert result.memory.decided_by == "principal:analyst-7"
    assert result.memory.tenant_id == TENANT


def test_reviewer_decision_becomes_reviewed_only_with_authoritative_support():
    reviewer = actor(role="reviewer", actor_id="principal:reviewer-42")
    reviewed = prepare_workspace_decision(
        decision_request(run()),
        actor=reviewer,
    )
    assert reviewed.memory.status == "reviewed"
    assert reviewed.memory.decided_by == reviewer.actor_id
    assert "measure:transportation" in reviewed.workspace.authoritative_entity_ids

    with pytest.raises(ValueError, match="authoritative lineage"):
        prepare_workspace_decision(
            decision_request(
                run(provisional=True),
                action="inspect_evidence",
                decision_type="evidence_correction",
                subject_id="barrier:food",
                evidence_entity_ids=["barrier:food"],
            ),
            actor=reviewer,
        )


def test_evidence_correction_can_target_provisional_entity_with_authoritative_support():
    corrected = prepare_workspace_decision(
        decision_request(
            run(provisional=True),
            action="inspect_evidence",
            decision_type="evidence_correction",
            subject_id="barrier:food",
            evidence_entity_ids=["measure:transportation"],
        ),
        actor=actor(role="reviewer"),
    )
    assert corrected.memory.status == "reviewed"
    assert corrected.memory.subject_id == "barrier:food"
    assert corrected.memory.evidence_entity_ids == ["measure:transportation"]


def test_action_must_be_currently_allowed_and_compatible_with_decision_type():
    with pytest.raises(PermissionError, match="not authorized"):
        prepare_workspace_decision(
            decision_request(run(), action="compare_plans"),
            actor=actor(role="analyst"),
        )

    with pytest.raises(ValueError, match="incompatible"):
        prepare_workspace_decision(
            decision_request(
                run(),
                action="compare_barriers",
                decision_type="evidence_correction",
            ),
            actor=actor(role="analyst"),
        )


def test_read_only_cross_tenant_and_unknown_entity_boundaries_fail_closed():
    with pytest.raises(PermissionError, match="read-only"):
        prepare_workspace_decision(
            decision_request(run(), action="inspect_evidence"),
            actor=actor(role="read_only"),
        )

    with pytest.raises(ValueError, match="tenant"):
        prepare_workspace_decision(
            decision_request(run()),
            actor=actor(role="analyst", tenant_id="tenant:other"),
        )

    with pytest.raises(ValueError, match="subject"):
        prepare_workspace_decision(
            decision_request(run(), subject_id="barrier:not-in-run"),
            actor=actor(role="analyst"),
        )

    bad_related = decision_request(run()).model_copy(
        update={"related_entity_ids": ["entity:other-county"]}
    )
    with pytest.raises(ValueError, match="related entities"):
        prepare_workspace_decision(bad_related, actor=actor(role="analyst"))

    with pytest.raises(ValueError, match="tenant-scoped"):
        prepare_workspace_decision(
            decision_request(run(tenant_id=None)),
            actor=actor(role="analyst", tenant_id=None),
        )


def test_publication_is_not_a_memory_only_workspace_command():
    payload = decision_request(run()).model_dump(mode="python")
    payload.update(
        {
            "action": "approve_publication",
            "decision_type": "publication_decision",
            "subject_id": run().run_id,
        }
    )
    with pytest.raises(ValidationError):
        WorkspaceDecisionRequest.model_validate(payload)


def test_record_workspace_decision_persists_rebuilt_governed_memory():
    connection = FakeConnection()
    reviewer = actor(role="reviewer", actor_id="principal:reviewer")
    result = record_workspace_decision(
        connection,
        decision_request(run()),
        actor=reviewer,
    )
    assert result.memory.status == "reviewed"
    assert result.memory.decided_by == reviewer.actor_id
    assert connection.executions[0][1] == (TENANT,)
    assert "INSERT INTO cbcap.decision_memory" in connection.executions[1][0]
