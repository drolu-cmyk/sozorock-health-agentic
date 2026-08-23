from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from time import perf_counter_ns
from typing import Any, Protocol

from langgraph.types import Command

from .authorization import (
    AuthorizedActor,
    RuntimeRole,
    require_actor_capability,
)
from .checkpoint import CheckpointSettings, checkpoint_thread_config, postgres_checkpointer
from .gateway import EvidenceGatewayResponse
from .gateway_transport import EvidenceGatewayHttpClient
from .graph import (
    CountyGraphContext,
    RunBudget,
    build_county_planning_graph,
    initial_graph_state,
)
from .models import CountyRunState
from .observability import (
    RunObservation,
    build_initial_run_observation,
    build_review_resume_observation,
    persist_run_observation,
)
from .persistence import (
    ConnectionLike,
    PersistenceSettings,
    persist_county_graph_trajectory,
    postgres_connection,
)
from .run_preparation import PreparedCountyGraphRun, prepare_county_graph_run
from .trajectory import TrajectoryEvent

# Compatibility name for callers already using RuntimeActor. The canonical
# authorization model lives in authorization.py so runtime/workspace services
# cannot drift into separate role systems.
RuntimeActor = AuthorizedActor


class CompiledGraphLike(Protocol):
    def invoke(
        self,
        input: Any,
        config: dict[str, Any] | None = None,
        *,
        context: CountyGraphContext | None = None,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class CountyRunExecution:
    graph_state: dict[str, Any]
    interrupted: bool
    trajectory_events: list[TrajectoryEvent]
    observation: RunObservation
    prepared: PreparedCountyGraphRun | None = None


def _elapsed_ms(started_ns: int) -> int:
    return max(0, (perf_counter_ns() - started_ns) // 1_000_000)


def _require_actor_tenant(run_tenant_id: str | None, actor: RuntimeActor) -> None:
    if run_tenant_id != actor.tenant_id:
        raise ValueError("county run tenant does not match authenticated actor tenant")


def _require_execution_authorization(run: CountyRunState, actor: RuntimeActor) -> None:
    _require_actor_tenant(run.tenant_id, actor)
    require_actor_capability(
        actor,
        "execute_county_run",
        geography_id=run.county.id,
        run_id=run.run_id,
    )


def _persist_graph_state(
    connection: ConnectionLike,
    graph_state: dict[str, Any],
    *,
    actor: RuntimeActor,
) -> list[TrajectoryEvent]:
    if "county_run" not in graph_state:
        raise RuntimeError("county graph returned no canonical county_run state")
    return persist_county_graph_trajectory(
        connection,
        graph_state,
        actor_tenant_id=actor.tenant_id,
    )


def execute_county_run(
    run: CountyRunState,
    budget: RunBudget,
    gateway_client: EvidenceGatewayHttpClient,
    graph: CompiledGraphLike,
    connection: ConnectionLike,
    *,
    actor: RuntimeActor,
    planning_pipeline_request: dict[str, Any] | None = None,
    etag: str | None = None,
    cached_response: EvidenceGatewayResponse | None = None,
) -> CountyRunExecution:
    """Execute one governed county run from one validated public-evidence fetch.

    Network retrieval occurs only after tenant, capability, geography and exact
    run-scope checks. The validated public package is reused by all evidence
    branches. Trajectory and operational observation records are persisted on
    both completed and interrupted runs.
    """

    _require_execution_authorization(run, actor)
    started_at = datetime.now(timezone.utc)
    total_started_ns = perf_counter_ns()
    prepared = prepare_county_graph_run(
        run,
        budget,
        gateway_client,
        etag=etag,
        cached_response=cached_response,
        planning_pipeline_request=planning_pipeline_request,
    )
    graph_started_ns = perf_counter_ns()
    graph_state = graph.invoke(
        initial_graph_state(run, budget=prepared.budget),
        config=checkpoint_thread_config(run.run_id, tenant_id=actor.tenant_id),
        context=prepared.context,
    )
    graph_duration_ms = _elapsed_ms(graph_started_ns)
    events = _persist_graph_state(
        connection,
        graph_state,
        actor=actor,
    )
    completed_at = datetime.now(timezone.utc)
    final_run = CountyRunState.model_validate(graph_state["county_run"])
    final_budget = RunBudget.model_validate(graph_state.get("budget", prepared.budget.model_dump(mode="json")))
    interrupted = "__interrupt__" in graph_state
    total_duration_ms = max(
        _elapsed_ms(total_started_ns),
        graph_duration_ms,
        prepared.evidence_fetch_ms,
    )
    observation = build_initial_run_observation(
        run,
        final_run,
        final_budget,
        started_at=started_at,
        completed_at=completed_at,
        evidence_fetch_ms=prepared.evidence_fetch_ms,
        graph_duration_ms=graph_duration_ms,
        total_duration_ms=total_duration_ms,
        evidence_release_id=prepared.evidence_release_id,
        evidence_release_hash=prepared.evidence_release_hash,
        interrupted=interrupted,
    )
    persist_run_observation(connection, observation)
    return CountyRunExecution(
        graph_state=graph_state,
        interrupted=interrupted,
        trajectory_events=events,
        observation=observation,
        prepared=prepared,
    )


def resume_county_run_review(
    run_id: str,
    graph: CompiledGraphLike,
    connection: ConnectionLike,
    *,
    actor: RuntimeActor,
    decision: str,
    reason: str,
) -> CountyRunExecution:
    """Resume a specifically authorized interrupted run without refetching evidence."""

    run_id = run_id.strip()
    reason = reason.strip()
    if not run_id or not reason:
        raise ValueError("run_id and reason are required")
    if decision not in {"approved", "rejected", "needs_revision", "deferred"}:
        raise ValueError("invalid review decision")

    require_actor_capability(
        actor,
        "resume_human_review",
        run_id=run_id,
    )

    started_at = datetime.now(timezone.utc)
    total_started_ns = perf_counter_ns()
    graph_started_ns = perf_counter_ns()
    graph_state = graph.invoke(
        Command(
            resume={
                "decision": decision,
                "reviewer": actor.actor_id,
                "reason": reason,
            }
        ),
        config=checkpoint_thread_config(run_id, tenant_id=actor.tenant_id),
        context=CountyGraphContext(),
    )
    graph_duration_ms = _elapsed_ms(graph_started_ns)
    canonical_run = CountyRunState.model_validate(graph_state["county_run"])
    _require_actor_tenant(canonical_run.tenant_id, actor)
    require_actor_capability(
        actor,
        "resume_human_review",
        geography_id=canonical_run.county.id,
        run_id=run_id,
    )
    events = _persist_graph_state(
        connection,
        graph_state,
        actor=actor,
    )
    completed_at = datetime.now(timezone.utc)
    final_budget = RunBudget.model_validate(graph_state.get("budget", {}))
    interrupted = "__interrupt__" in graph_state
    total_duration_ms = max(_elapsed_ms(total_started_ns), graph_duration_ms)
    observation = build_review_resume_observation(
        canonical_run,
        final_budget,
        started_at=started_at,
        completed_at=completed_at,
        graph_duration_ms=graph_duration_ms,
        total_duration_ms=total_duration_ms,
        interrupted=interrupted,
    )
    persist_run_observation(connection, observation)
    return CountyRunExecution(
        graph_state=graph_state,
        interrupted=interrupted,
        trajectory_events=events,
        observation=observation,
    )


def execute_county_run_from_env(
    run: CountyRunState,
    budget: RunBudget,
    *,
    actor: RuntimeActor,
    planning_pipeline_request: dict[str, Any] | None = None,
    checkpoint_settings: CheckpointSettings | None = None,
    persistence_settings: PersistenceSettings | None = None,
) -> CountyRunExecution:
    """Production convenience entrypoint. No in-memory or insecure fallback."""

    _require_execution_authorization(run, actor)
    if not actor.tenant_id:
        raise ValueError("production county execution requires an authenticated tenant")
    endpoint = os.getenv("CB_CAP_EVIDENCE_GATEWAY_URL", "").strip()
    if not endpoint:
        raise RuntimeError("CB_CAP_EVIDENCE_GATEWAY_URL is required")
    gateway_client = EvidenceGatewayHttpClient(endpoint)

    with postgres_connection(
        persistence_settings,
        tenant_id=actor.tenant_id,
    ) as connection:
        with postgres_checkpointer(
            checkpoint_settings,
            tenant_id=actor.tenant_id,
        ) as checkpointer:
            graph = build_county_planning_graph(checkpointer=checkpointer)
            return execute_county_run(
                run,
                budget,
                gateway_client,
                graph,
                connection,
                actor=actor,
                planning_pipeline_request=planning_pipeline_request,
            )
