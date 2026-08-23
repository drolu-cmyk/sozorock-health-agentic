from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.graph import RunBudget
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus
from cbcap_core.runtime_service import CountyRunExecution
import cbcap_core.runtime_observability as runtime_observability

NOW = datetime(2026, 8, 22, 23, 59, tzinfo=timezone.utc)
TENANT = "tenant:albany-planning"
COUNTY_ID = "county:36001"
RUN_ID = "run:observed:36001"


def actor() -> AuthorizedActor:
    grant = AuthorizationGrant(
        grant_id="grant:observability-test",
        actor_id="principal:planner",
        tenant_id=TENANT,
        capabilities=sorted(ROLE_CAPABILITIES["planner"]),
        geography_ids=[COUNTY_ID],
        run_ids=[RUN_ID],
        issuer="test-identity-verifier",
        issued_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        expires_at=datetime(2099, 1, 1, tzinfo=timezone.utc),
    )
    return AuthorizedActor(
        actor_id="principal:planner",
        tenant_id=TENANT,
        role="planner",
        authorization=grant,
    )


def run() -> CountyRunState:
    return CountyRunState(
        run_id=RUN_ID,
        tenant_id=TENANT,
        county=GeographyRef(
            id=COUNTY_ID,
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
        requested_at=NOW,
    )


class FakeConnection:
    pass


def prepared(budget: RunBudget):
    return SimpleNamespace(
        budget=budget,
        gateway_response=SimpleNamespace(
            manifest=SimpleNamespace(
                release_id="release:fixture",
                release_hash="sha256:" + "a" * 64,
            )
        ),
    )


def execution(final_budget: RunBudget, *, interrupted=False) -> CountyRunExecution:
    return CountyRunExecution(
        graph_state={
            "county_run": run().model_dump(mode="json"),
            "budget": final_budget.model_dump(mode="json"),
        },
        interrupted=interrupted,
        trajectory_events=[],
        prepared=prepared(final_budget),
    )


def test_observed_execution_persists_summary_using_final_graph_budget_and_release(monkeypatch):
    initial_budget = RunBudget(max_external_calls=5)
    final_budget = RunBudget(
        max_external_calls=5,
        preflight_external_calls_used=1,
        external_calls_used=2,
        model_calls_used=0,
        input_tokens_used=0,
        output_tokens_used=0,
        estimated_model_cost_usd=0,
    )
    observed_execution = execution(final_budget)
    built = []
    persisted = []

    monkeypatch.setattr(
        runtime_observability,
        "execute_county_run",
        lambda *args, **kwargs: observed_execution,
    )

    def fake_build_run_telemetry(**kwargs):
        built.append(kwargs)
        return SimpleNamespace(run_id=RUN_ID, estimated_model_cost_usd=0)

    monkeypatch.setattr(runtime_observability, "build_run_telemetry", fake_build_run_telemetry)
    monkeypatch.setattr(
        runtime_observability,
        "persist_run_telemetry",
        lambda connection, summary, *, actor_tenant_id: persisted.append(
            (connection, summary, actor_tenant_id)
        ),
    )

    connection = FakeConnection()
    result = runtime_observability.execute_observed_county_run(
        run(),
        initial_budget,
        object(),  # type: ignore[arg-type]
        object(),  # type: ignore[arg-type]
        connection,  # type: ignore[arg-type]
        actor=actor(),
    )

    assert result.execution is observed_execution
    assert built[0]["budget"] == final_budget
    assert built[0]["source_release_id"] == "release:fixture"
    assert built[0]["source_release_hash"] == "sha256:" + "a" * 64
    assert built[0]["failure_reason"] is None
    assert persisted[0][0] is connection
    assert persisted[0][2] == TENANT


def test_failure_telemetry_persists_exception_class_not_exception_message(monkeypatch):
    class SecretFailure(RuntimeError):
        pass

    failure = SecretFailure("token=should-never-enter-telemetry")
    built = []
    persisted = []

    def fail_execution(*args, **kwargs):
        raise failure

    monkeypatch.setattr(runtime_observability, "execute_county_run", fail_execution)

    def fake_build_run_telemetry(**kwargs):
        built.append(kwargs)
        return SimpleNamespace(run_id=RUN_ID)

    monkeypatch.setattr(runtime_observability, "build_run_telemetry", fake_build_run_telemetry)
    monkeypatch.setattr(
        runtime_observability,
        "persist_run_telemetry",
        lambda connection, summary, *, actor_tenant_id: persisted.append(
            (summary, actor_tenant_id)
        ),
    )

    with pytest.raises(SecretFailure, match="should-never-enter-telemetry"):
        runtime_observability.execute_observed_county_run(
            run(),
            RunBudget(max_external_calls=1),
            object(),  # type: ignore[arg-type]
            object(),  # type: ignore[arg-type]
            FakeConnection(),  # type: ignore[arg-type]
            actor=actor(),
        )

    assert built[0]["failure_reason"] == "SecretFailure"
    assert "should-never-enter-telemetry" not in built[0]["failure_reason"]
    assert persisted[0][1] == TENANT


def test_telemetry_write_failure_never_masks_original_execution_failure(monkeypatch):
    original = RuntimeError("original execution failure")

    monkeypatch.setattr(
        runtime_observability,
        "execute_county_run",
        lambda *args, **kwargs: (_ for _ in ()).throw(original),
    )
    monkeypatch.setattr(
        runtime_observability,
        "build_run_telemetry",
        lambda **kwargs: SimpleNamespace(run_id=RUN_ID),
    )
    monkeypatch.setattr(
        runtime_observability,
        "persist_run_telemetry",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("telemetry unavailable")),
    )

    with pytest.raises(RuntimeError, match="original execution failure") as caught:
        runtime_observability.execute_observed_county_run(
            run(),
            RunBudget(max_external_calls=1),
            object(),  # type: ignore[arg-type]
            object(),  # type: ignore[arg-type]
            FakeConnection(),  # type: ignore[arg-type]
            actor=actor(),
        )

    notes = getattr(caught.value, "__notes__", [])
    assert any("telemetry persistence failed" in note.lower() for note in notes)
    assert all("telemetry unavailable" not in note for note in notes)


def test_resumed_execution_creates_separate_run_telemetry_without_source_release(monkeypatch):
    final_budget = RunBudget(max_external_calls=0)
    resumed = CountyRunExecution(
        graph_state={
            "county_run": run().model_dump(mode="json"),
            "budget": final_budget.model_dump(mode="json"),
        },
        interrupted=False,
        trajectory_events=[],
        prepared=None,
    )
    built = []
    persisted = []
    reviewer = actor().model_copy(
        update={
            "role": "reviewer",
            "authorization": AuthorizationGrant(
                grant_id="grant:reviewer",
                actor_id="principal:planner",
                tenant_id=TENANT,
                capabilities=["read_workspace", "resume_human_review"],
                geography_ids=[COUNTY_ID],
                run_ids=[RUN_ID],
                issuer="test-identity-verifier",
                issued_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                expires_at=datetime(2099, 1, 1, tzinfo=timezone.utc),
            ),
        }
    )

    monkeypatch.setattr(
        runtime_observability,
        "resume_county_run_review",
        lambda *args, **kwargs: resumed,
    )
    monkeypatch.setattr(
        runtime_observability,
        "build_run_telemetry",
        lambda **kwargs: built.append(kwargs) or SimpleNamespace(run_id=RUN_ID),
    )
    monkeypatch.setattr(
        runtime_observability,
        "persist_run_telemetry",
        lambda connection, summary, *, actor_tenant_id: persisted.append(actor_tenant_id),
    )

    runtime_observability.resume_observed_county_run_review(
        RUN_ID,
        object(),  # type: ignore[arg-type]
        FakeConnection(),  # type: ignore[arg-type]
        actor=reviewer,
        decision="approved",
        reason="Reviewed.",
    )

    assert built[0]["source_release_id"] is None
    assert built[0]["source_release_hash"] is None
    assert persisted == [TENANT]
