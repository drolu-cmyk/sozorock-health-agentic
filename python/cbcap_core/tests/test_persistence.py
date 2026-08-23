from datetime import datetime, timezone

import pytest

from cbcap_core.institutional_memory import DecisionMemoryRecord
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus
from cbcap_core.persistence import (
    PersistenceSettings,
    canonicalize_trajectory_event,
    canonicalize_trajectory_events,
    persist_county_graph_trajectory,
    persist_decision_memory,
    persist_trajectory_events,
)

NOW = datetime(2026, 8, 22, 23, 20, tzinfo=timezone.utc)
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


def run(*, tenant_id: str | None = TENANT) -> CountyRunState:
    return CountyRunState(
        run_id="run:albany:2026-08-22",
        tenant_id=tenant_id,
        county=county(),
        requested_at=NOW,
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
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_persistence_settings_require_tls_by_default():
    with pytest.raises(RuntimeError, match="require TLS"):
        PersistenceSettings("postgresql://db.example/cbcap").validate()

    PersistenceSettings(
        "postgresql://db.example/cbcap?sslmode=verify-full"
    ).validate()


def test_lightweight_graph_event_becomes_canonical_zero_token_trajectory():
    event = canonicalize_trajectory_event(
        {
            "id": "trajectory:barrier:1",
            "run_id": run().run_id,
            "stage": "barrier_classification",
            "entity_id": "measure:transportation",
            "outcome": "admitted",
            "reason_codes": ["measure_in_barrier_ontology"],
            "occurred_at": NOW.isoformat(),
        },
        run(),
    )
    assert event.tenant_id == TENANT
    assert event.geography_id == county().id
    assert event.actor_type == "deterministic"
    assert event.actor_name == "cbcap.county-planning-graph"
    assert event.outcome_class == "accepted"
    assert event.input_tokens == 0
    assert event.output_tokens == 0
    assert event.estimated_cost_usd == 0


def test_planning_pipeline_event_is_normalized_without_relabeling_review_as_acceptance():
    event = canonicalize_trajectory_event(
        {
            "id": "trajectory:planning:1",
            "run_id": run().run_id,
            "stage": "document_admission",
            "entity_id": "plan:chip",
            "outcome": "review_required",
            "reason_codes": ["claim_review_required"],
            "occurred_at": NOW,
        },
        run(),
    )
    assert event.actor_name == "cbcap.planning-pipeline"
    assert event.outcome_class == "review_required"


def test_candidate_discovery_maps_to_canonical_source_discovery_stage():
    event = canonicalize_trajectory_event(
        {
            "id": "trajectory:planning:discovery",
            "run_id": run().run_id,
            "stage": "candidate_discovery",
            "entity_id": "candidate:1",
            "outcome": "accepted",
            "occurred_at": NOW,
        },
        run(),
    )
    assert event.stage == "source_discovery"


def test_canonical_event_cannot_cross_run_geography_or_tenant_boundaries():
    with pytest.raises(ValueError, match="run_id"):
        canonicalize_trajectory_event(
            {
                "id": "trajectory:wrong-run",
                "run_id": "run:other",
                "stage": "barrier_classification",
                "entity_id": "measure:1",
                "outcome": "admitted",
                "occurred_at": NOW,
            },
            run(),
        )

    full = {
        "id": "trajectory:wrong-tenant",
        "run_id": run().run_id,
        "tenant_id": "tenant:other",
        "geography_id": county().id,
        "stage": "barrier_classification",
        "actor_type": "deterministic",
        "actor_name": "barrier-classifier",
        "actor_version": "v1",
        "entity_id": "measure:1",
        "outcome": "admitted",
        "outcome_class": "accepted",
        "occurred_at": NOW,
    }
    with pytest.raises(ValueError, match="tenant"):
        canonicalize_trajectory_event(full, run())


def test_duplicate_event_id_with_different_payload_fails_closed():
    base = {
        "id": "trajectory:collision",
        "run_id": run().run_id,
        "stage": "barrier_classification",
        "entity_id": "measure:1",
        "outcome": "admitted",
        "occurred_at": NOW,
    }
    with pytest.raises(ValueError, match="collision"):
        canonicalize_trajectory_events(
            [base, {**base, "outcome": "rejected"}],
            run(),
        )


def test_persist_trajectory_sets_tenant_rls_scope_and_writes_append_only_row():
    connection = FakeConnection()
    event = canonicalize_trajectory_event(
        {
            "id": "trajectory:persist:1",
            "run_id": run().run_id,
            "stage": "workforce_source_coverage",
            "entity_id": county().id,
            "outcome": "complete_no_designations",
            "reason_codes": [],
            "occurred_at": NOW,
        },
        run(),
    )
    written = persist_trajectory_events(
        connection,
        [event],
        actor_tenant_id=TENANT,
    )
    assert written == 1
    assert connection.executions[0][0].startswith("SELECT set_config('app.tenant_id'")
    assert "INSERT INTO cbcap.trajectory_event" in connection.executions[1][0]
    assert "ON CONFLICT (id) DO NOTHING" in connection.executions[1][0]


def test_persist_county_graph_trajectory_rejects_cross_tenant_actor():
    state = {
        "county_run": run().model_dump(mode="json"),
        "trajectory_events": [],
    }
    with pytest.raises(ValueError, match="county run tenant"):
        persist_county_graph_trajectory(
            FakeConnection(),
            state,
            actor_tenant_id="tenant:other",
        )


def decision_memory() -> DecisionMemoryRecord:
    return DecisionMemoryRecord(
        id="memory:funding:1",
        tenant_id=TENANT,
        geography_id=county().id,
        decision_type="funding_fit",
        subject_type="funding_opportunity",
        subject_id="funding:transportation",
        outcome="rejected",
        reason_codes=["required_partner_missing"],
        rationale="The fit was not actionable because the required implementation partner was missing.",
        evidence_entity_ids=["funding-fit:transportation"],
        related_entity_ids=["funding:transportation"],
        missing_requirements=["partner:transportation-provider"],
        decided_by="reviewer:1",
        decided_at=NOW,
        status="reviewed",
        applicability="reusable",
    )


def test_persist_decision_memory_is_tenant_bound_and_rls_scoped():
    connection = FakeConnection()
    persist_decision_memory(connection, decision_memory(), actor_tenant_id=TENANT)
    assert connection.executions[0][1] == (TENANT,)
    assert "INSERT INTO cbcap.decision_memory" in connection.executions[1][0]

    with pytest.raises(ValueError, match="decision memory tenant"):
        persist_decision_memory(
            FakeConnection(),
            decision_memory(),
            actor_tenant_id="tenant:other",
        )
