from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from cbcap_core.graph import RunBudget
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus, RunStatus
from cbcap_core.observability import (
    RunObservation,
    build_initial_run_observation,
    build_review_resume_observation,
    persist_run_observation,
)

NOW = datetime(2026, 8, 22, 23, 0, tzinfo=timezone.utc)
TENANT = "tenant:albany-planning"


def run(*, requested_at=NOW, status=RunStatus.COMPLETED) -> CountyRunState:
    return CountyRunState(
        run_id="run:observation:36001",
        tenant_id=TENANT,
        county=GeographyRef(
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
        ),
        requested_at=requested_at,
        status=status,
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


def test_initial_observation_captures_queue_source_graph_budget_and_release_metrics():
    started = NOW + timedelta(seconds=2)
    completed = started + timedelta(milliseconds=900)
    budget = RunBudget(
        max_external_calls=10,
        max_model_tokens=1000,
        max_model_cost_usd=10,
        preflight_external_calls_used=1,
        external_calls_used=3,
        model_tokens_used=240,
        model_cost_usd=0.12,
    )
    observation = build_initial_run_observation(
        run(status=RunStatus.RUNNING),
        run(status=RunStatus.COMPLETED),
        budget,
        started_at=started,
        completed_at=completed,
        evidence_fetch_ms=125,
        graph_duration_ms=600,
        total_duration_ms=900,
        evidence_release_id="release:test",
        evidence_release_hash="sha256:" + "a" * 64,
        interrupted=False,
    )

    assert observation.phase == "initial"
    assert observation.queue_wait_ms == 2000
    assert observation.request_clock_skew_detected is False
    assert observation.evidence_fetch_ms == 125
    assert observation.graph_duration_ms == 600
    assert observation.total_duration_ms == 900
    assert observation.external_calls_used == 3
    assert observation.model_tokens_used == 240
    assert observation.model_cost_usd == 0.12
    assert observation.evidence_release_hash == "sha256:" + "a" * 64
    assert observation.review_intervention is False
    assert observation.id.startswith("run-observation:sha256:")


def test_future_request_timestamp_is_flagged_without_negative_queue_latency():
    source = run(requested_at=NOW + timedelta(seconds=5), status=RunStatus.RUNNING)
    final = run(requested_at=source.requested_at, status=RunStatus.BLOCKED)
    observation = build_initial_run_observation(
        source,
        final,
        RunBudget(),
        started_at=NOW,
        completed_at=NOW + timedelta(milliseconds=100),
        evidence_fetch_ms=10,
        graph_duration_ms=50,
        total_duration_ms=100,
        evidence_release_id="release:test",
        evidence_release_hash="sha256:" + "b" * 64,
        interrupted=False,
    )
    assert observation.queue_wait_ms == 0
    assert observation.request_clock_skew_detected is True


def test_review_resume_is_a_separate_phase_with_no_new_evidence_fetch_claim():
    started = NOW + timedelta(minutes=5)
    observation = build_review_resume_observation(
        run(status=RunStatus.COMPLETED),
        RunBudget(external_calls_used=0),
        started_at=started,
        completed_at=started + timedelta(milliseconds=300),
        graph_duration_ms=250,
        total_duration_ms=300,
        interrupted=False,
    )
    assert observation.phase == "review_resume"
    assert observation.evidence_fetch_ms is None
    assert observation.evidence_release_id is None
    assert observation.evidence_release_hash is None
    assert observation.queue_wait_ms is None
    assert observation.review_intervention is True


def test_observation_rejects_impossible_or_naive_timings():
    with pytest.raises(ValidationError, match="timezone-aware"):
        RunObservation(
            id="observation:naive",
            run_id="run:1",
            tenant_id=TENANT,
            geography_id="county:36001",
            phase="initial",
            status=RunStatus.COMPLETED,
            evidence_release_id="release:test",
            evidence_release_hash="sha256:" + "c" * 64,
            requested_at=datetime(2026, 8, 22, 20, 0),
            started_at=datetime(2026, 8, 22, 20, 1),
            completed_at=datetime(2026, 8, 22, 20, 2),
            queue_wait_ms=60000,
            evidence_fetch_ms=10,
            graph_duration_ms=50,
            total_duration_ms=100,
            external_calls_used=1,
            model_tokens_used=0,
            model_cost_usd=0,
            interrupted=False,
            review_count=0,
            review_intervention=False,
        )

    with pytest.raises(ValidationError, match="shorter than graph"):
        RunObservation(
            id="observation:impossible",
            run_id="run:1",
            tenant_id=TENANT,
            geography_id="county:36001",
            phase="initial",
            status=RunStatus.COMPLETED,
            evidence_release_id="release:test",
            evidence_release_hash="sha256:" + "d" * 64,
            requested_at=NOW,
            started_at=NOW,
            completed_at=NOW + timedelta(milliseconds=50),
            queue_wait_ms=0,
            evidence_fetch_ms=10,
            graph_duration_ms=100,
            total_duration_ms=50,
            external_calls_used=1,
            model_tokens_used=0,
            model_cost_usd=0,
            interrupted=False,
            review_count=0,
            review_intervention=False,
        )


def test_resume_observation_rejects_evidence_release_or_queue_fields():
    with pytest.raises(ValidationError, match="cannot report evidence fetch"):
        RunObservation(
            id="observation:resume-invalid",
            run_id="run:1",
            tenant_id=TENANT,
            geography_id="county:36001",
            phase="review_resume",
            status=RunStatus.COMPLETED,
            evidence_release_id=None,
            evidence_release_hash=None,
            requested_at=None,
            started_at=NOW,
            completed_at=NOW + timedelta(milliseconds=100),
            queue_wait_ms=None,
            evidence_fetch_ms=1,
            graph_duration_ms=50,
            total_duration_ms=100,
            external_calls_used=0,
            model_tokens_used=0,
            model_cost_usd=0,
            interrupted=False,
            review_count=1,
            review_intervention=True,
        )


def test_persistence_sets_rls_scope_and_writes_no_freeform_source_content():
    observation = build_initial_run_observation(
        run(status=RunStatus.RUNNING),
        run(status=RunStatus.COMPLETED),
        RunBudget(external_calls_used=1, preflight_external_calls_used=1),
        started_at=NOW + timedelta(seconds=1),
        completed_at=NOW + timedelta(seconds=2),
        evidence_fetch_ms=100,
        graph_duration_ms=600,
        total_duration_ms=1000,
        evidence_release_id="release:test",
        evidence_release_hash="sha256:" + "e" * 64,
        interrupted=False,
    )
    connection = FakeConnection()
    persist_run_observation(connection, observation)

    assert connection.executions[0][1] == (TENANT,)
    insert, params = connection.executions[1]
    assert "INSERT INTO cbcap.run_observation" in insert
    assert "source_document" not in insert.lower()
    assert "evidence_claim" not in insert.lower()
    assert params[0] == observation.id
    assert params[1] == observation.run_id
