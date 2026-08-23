from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from cbcap_core.authorization import AuthorizationGrant, ROLE_CAPABILITIES
from cbcap_core.gateway import EvidenceGatewayResponse
from cbcap_core.gateway_transport import EvidenceGatewayFetchResult, package_release_hash
from cbcap_core.graph import RunBudget
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus
from cbcap_core.runtime_service import (
    RuntimeActor,
    execute_county_run,
    resume_county_run_review,
)

FIXTURE = Path(__file__).parent / "fixtures" / "evidence-gateway-v1.json"
NOW = datetime(2026, 8, 22, 23, 50, tzinfo=timezone.utc)
AUTH_ISSUED = datetime(2026, 1, 1, tzinfo=timezone.utc)
AUTH_EXPIRES = datetime(2027, 1, 1, tzinfo=timezone.utc)
TENANT = "tenant:albany-planning"
COUNTY_ID = "county:36001"
RUN_ID = "run:runtime:36001"


def actor(
    *,
    role="planner",
    tenant_id=TENANT,
    actor_id="principal:planner",
    geography_ids=None,
    run_ids=None,
    capabilities=None,
) -> RuntimeActor:
    grant = AuthorizationGrant(
        grant_id=f"grant:{actor_id}",
        actor_id=actor_id,
        tenant_id=tenant_id,
        capabilities=capabilities or sorted(ROLE_CAPABILITIES[role]),
        geography_ids=geography_ids if geography_ids is not None else [COUNTY_ID],
        run_ids=run_ids if run_ids is not None else [RUN_ID],
        issuer="test-identity-verifier",
        issued_at=AUTH_ISSUED,
        expires_at=AUTH_EXPIRES,
    )
    return RuntimeActor(
        actor_id=actor_id,
        tenant_id=tenant_id,
        role=role,
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


def gateway_response() -> EvidenceGatewayResponse:
    package = json.loads(FIXTURE.read_text())
    release_hash = package_release_hash(package)
    return EvidenceGatewayResponse.model_validate(
        {
            "manifest": {
                "contract_version": "sozorock.evidence-gateway.v1",
                "release_id": package["release_id"],
                "generated_at": package["generated_at"],
                "evidence_core_schema_version": "evidence-core.fixture.v1",
                "release_hash": release_hash,
                "source_versions": package["source_versions"],
            },
            "package": package,
        }
    )


class FakeGatewayClient:
    def __init__(self):
        self.response = gateway_response()
        self.calls = []

    def fetch_county(self, county_fips: str, *, etag: str | None = None):
        self.calls.append((county_fips, etag))
        return EvidenceGatewayFetchResult(
            response=self.response,
            etag=f'"{self.response.manifest.release_hash}"',
            elapsed_ms=37,
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


class FakeGraph:
    def __init__(self, *, interrupted: bool = False):
        self.interrupted = interrupted
        self.calls = []

    def invoke(self, input, config=None, *, context=None):
        self.calls.append((input, config, context))
        if isinstance(input, dict):
            county_run = input["county_run"]
            run_id = county_run["run_id"]
        else:
            county_run = run().model_dump(mode="json")
            run_id = county_run["run_id"]
        state = {
            "county_run": county_run,
            "budget": input.get("budget", {}) if isinstance(input, dict) else {},
            "trajectory_events": [
                {
                    "id": f"trajectory:{run_id}:public-evidence",
                    "run_id": run_id,
                    "stage": "public_evidence",
                    "entity_id": "release:fixture",
                    "outcome": "completed",
                    "reason_codes": [],
                    "occurred_at": NOW.isoformat(),
                }
            ],
        }
        if self.interrupted:
            state["__interrupt__"] = [{"type": "cbcap_human_review"}]
        return state


def test_cross_tenant_actor_is_rejected_before_gateway_or_graph_execution():
    gateway = FakeGatewayClient()
    graph = FakeGraph()

    with pytest.raises(ValueError, match="tenant"):
        execute_county_run(
            run(),
            RunBudget(max_external_calls=1),
            gateway,  # type: ignore[arg-type]
            graph,  # type: ignore[arg-type]
            FakeConnection(),
            actor=actor(tenant_id="tenant:other"),
        )

    assert gateway.calls == []
    assert graph.calls == []


def test_actor_without_execution_capability_cannot_reach_network():
    gateway = FakeGatewayClient()
    graph = FakeGraph()

    with pytest.raises(PermissionError, match="execute_county_run"):
        execute_county_run(
            run(),
            RunBudget(max_external_calls=1),
            gateway,  # type: ignore[arg-type]
            graph,  # type: ignore[arg-type]
            FakeConnection(),
            actor=actor(role="read_only", actor_id="principal:reader"),
        )

    assert gateway.calls == []
    assert graph.calls == []


def test_actor_without_county_scope_cannot_reach_network_or_graph():
    gateway = FakeGatewayClient()
    graph = FakeGraph()
    with pytest.raises(PermissionError, match="geography"):
        execute_county_run(
            run(),
            RunBudget(max_external_calls=1),
            gateway,  # type: ignore[arg-type]
            graph,  # type: ignore[arg-type]
            FakeConnection(),
            actor=actor(geography_ids=["county:42029"]),
        )
    assert gateway.calls == []
    assert graph.calls == []


def test_actor_without_specific_run_scope_cannot_reach_network_or_graph():
    gateway = FakeGatewayClient()
    graph = FakeGraph()
    with pytest.raises(PermissionError, match="county run"):
        execute_county_run(
            run(),
            RunBudget(max_external_calls=1),
            gateway,  # type: ignore[arg-type]
            graph,  # type: ignore[arg-type]
            FakeConnection(),
            actor=actor(run_ids=["run:other"]),
        )
    assert gateway.calls == []
    assert graph.calls == []


def test_execution_fetches_public_evidence_once_and_persists_trajectory_and_observation():
    gateway = FakeGatewayClient()
    graph = FakeGraph()
    connection = FakeConnection()

    result = execute_county_run(
        run(),
        RunBudget(max_external_calls=1),
        gateway,  # type: ignore[arg-type]
        graph,  # type: ignore[arg-type]
        connection,
        actor=actor(),
    )

    assert gateway.calls == [("36001", None)]
    assert len(graph.calls) == 1
    _, config, context = graph.calls[0]
    assert config["configurable"]["thread_id"] == f"cbcap:{TENANT}:county-run:{run().run_id}"
    assert context.public_evidence_package["release_id"] == gateway.response.manifest.release_id
    assert result.prepared is not None
    assert result.prepared.budget.preflight_external_calls_used == 1
    assert result.prepared.evidence_fetch_ms == 37
    assert result.interrupted is False
    assert len(result.trajectory_events) == 1
    assert result.observation.phase == "initial"
    assert result.observation.evidence_fetch_ms == 37
    assert result.observation.evidence_release_hash == gateway.response.manifest.release_hash
    assert result.observation.external_calls_used == 1
    assert result.observation.review_intervention is False
    assert any("INSERT INTO cbcap.trajectory_event" in query for query, _ in connection.executions)
    assert any("INSERT INTO cbcap.run_observation" in query for query, _ in connection.executions)


def test_interrupted_execution_persists_partial_trajectory_and_review_observation():
    gateway = FakeGatewayClient()
    graph = FakeGraph(interrupted=True)
    connection = FakeConnection()

    result = execute_county_run(
        run(),
        RunBudget(max_external_calls=1),
        gateway,  # type: ignore[arg-type]
        graph,  # type: ignore[arg-type]
        connection,
        actor=actor(),
    )
    assert result.interrupted is True
    assert len(result.trajectory_events) == 1
    assert result.observation.phase == "initial"
    assert result.observation.interrupted is True
    assert result.observation.review_intervention is True


def test_nonreview_roles_lack_resume_capability_before_checkpoint_access():
    graph = FakeGraph()
    for role in ("read_only", "analyst", "planner"):
        with pytest.raises(PermissionError, match="resume_human_review"):
            resume_county_run_review(
                run().run_id,
                graph,  # type: ignore[arg-type]
                FakeConnection(),
                actor=actor(role=role, actor_id=f"principal:{role}"),
                decision="approved",
                reason="Attempted review without reviewer authority.",
            )
    assert graph.calls == []


def test_reviewer_without_specific_run_scope_cannot_touch_checkpoint():
    graph = FakeGraph()
    with pytest.raises(PermissionError, match="county run"):
        resume_county_run_review(
            run().run_id,
            graph,  # type: ignore[arg-type]
            FakeConnection(),
            actor=actor(
                role="reviewer",
                actor_id="principal:reviewer-no-run",
                run_ids=["run:other"],
            ),
            decision="approved",
            reason="Attempted review outside run grant.",
        )
    assert graph.calls == []


def test_review_resume_uses_authenticated_identity_no_refetch_and_separate_observation():
    graph = FakeGraph()
    connection = FakeConnection()
    reviewer = actor(role="reviewer", actor_id="principal:reviewer-42")

    result = resume_county_run_review(
        run().run_id,
        graph,  # type: ignore[arg-type]
        connection,
        actor=reviewer,
        decision="approved",
        reason="Verified against authoritative source evidence.",
    )

    assert len(graph.calls) == 1
    command, config, context = graph.calls[0]
    assert config["configurable"]["thread_id"] == f"cbcap:{TENANT}:county-run:{run().run_id}"
    assert context.public_evidence_package is None
    assert getattr(command, "resume")["reviewer"] == reviewer.actor_id
    assert getattr(command, "resume")["decision"] == "approved"
    assert result.prepared is None
    assert len(result.trajectory_events) == 1
    assert result.observation.phase == "review_resume"
    assert result.observation.evidence_fetch_ms is None
    assert result.observation.evidence_release_hash is None
    assert result.observation.external_calls_used == 0
    assert result.observation.review_intervention is True
    assert any("INSERT INTO cbcap.run_observation" in query for query, _ in connection.executions)


def test_invalid_review_decision_fails_before_authorization_or_graph_resume():
    graph = FakeGraph()
    with pytest.raises(ValueError, match="invalid review decision"):
        resume_county_run_review(
            run().run_id,
            graph,  # type: ignore[arg-type]
            FakeConnection(),
            actor=actor(role="reviewer", actor_id="principal:reviewer"),
            decision="publish_now",
            reason="Not an allowed review action.",
        )
    assert graph.calls == []
