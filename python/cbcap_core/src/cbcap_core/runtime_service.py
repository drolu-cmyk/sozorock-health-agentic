from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Protocol

from langgraph.types import Command

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
from .persistence import (
    ConnectionLike,
    PersistenceSettings,
    persist_county_graph_trajectory,
    postgres_connection,
)
from .run_preparation import PreparedCountyGraphRun, prepare_county_graph_run
from .trajectory import TrajectoryEvent


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
    prepared: PreparedCountyGraphRun | None = None


def _require_actor_tenant(run_tenant_id: str | None, actor_tenant_id: str | None) -> None:
    if run_tenant_id != actor_tenant_id:
        raise ValueError("county run tenant does not match authenticated actor tenant")


def _persist_graph_state(
    connection: ConnectionLike,
    graph_state: dict[str, Any],
    *,
    actor_tenant_id: str | None,
) -> list[TrajectoryEvent]:
    if "county_run" not in graph_state:
        raise RuntimeError("county graph returned no canonical county_run state")
    return persist_county_graph_trajectory(
        connection,
        graph_state,
        actor_tenant_id=actor_tenant_id,
    )


def execute_county_run(
    run: CountyRunState,
    budget: RunBudget,
    gateway_client: EvidenceGatewayHttpClient,
    graph: CompiledGraphLike,
    connection: ConnectionLike,
    *,
    actor_tenant_id: str | None,
    planning_pipeline_request: dict[str, Any] | None = None,
    etag: str | None = None,
    cached_response: EvidenceGatewayResponse | None = None,
) -> CountyRunExecution:
    """Execute one governed county run from one validated public-evidence fetch.

    Network retrieval occurs before graph fan-out. The resulting immutable public
    package is reused by all evidence branches. Trajectory state is persisted on
    both completed and interrupted runs so review checkpoints never erase the
    path that led to a human decision.
    """

    _require_actor_tenant(run.tenant_id, actor_tenant_id)
    prepared = prepare_county_graph_run(
        run,
        budget,
        gateway_client,
        etag=etag,
        cached_response=cached_response,
        planning_pipeline_request=planning_pipeline_request,
    )
    graph_state = graph.invoke(
        initial_graph_state(run, budget=prepared.budget),
        config=checkpoint_thread_config(run.run_id, tenant_id=run.tenant_id),
        context=prepared.context,
    )
    events = _persist_graph_state(
        connection,
        graph_state,
        actor_tenant_id=actor_tenant_id,
    )
    return CountyRunExecution(
        graph_state=graph_state,
        interrupted="__interrupt__" in graph_state,
        trajectory_events=events,
        prepared=prepared,
    )


def resume_county_run_review(
    run_id: str,
    graph: CompiledGraphLike,
    connection: ConnectionLike,
    *,
    actor_tenant_id: str | None,
    decision: str,
    reviewer: str,
    reason: str,
) -> CountyRunExecution:
    """Resume a previously interrupted graph without refetching public evidence."""

    run_id = run_id.strip()
    reviewer = reviewer.strip()
    reason = reason.strip()
    if not run_id or not reviewer or not reason:
        raise ValueError("run_id, reviewer, and reason are required")
    if decision not in {"approved", "rejected", "needs_revision", "deferred"}:
        raise ValueError("invalid review decision")

    graph_state = graph.invoke(
        Command(
            resume={
                "decision": decision,
                "reviewer": reviewer,
                "reason": reason,
            }
        ),
        config=checkpoint_thread_config(run_id, tenant_id=actor_tenant_id),
        context=CountyGraphContext(),
    )
    canonical_run = CountyRunState.model_validate(graph_state["county_run"])
    _require_actor_tenant(canonical_run.tenant_id, actor_tenant_id)
    events = _persist_graph_state(
        connection,
        graph_state,
        actor_tenant_id=actor_tenant_id,
    )
    return CountyRunExecution(
        graph_state=graph_state,
        interrupted="__interrupt__" in graph_state,
        trajectory_events=events,
    )


def execute_county_run_from_env(
    run: CountyRunState,
    budget: RunBudget,
    *,
    actor_tenant_id: str | None,
    planning_pipeline_request: dict[str, Any] | None = None,
    checkpoint_settings: CheckpointSettings | None = None,
    persistence_settings: PersistenceSettings | None = None,
) -> CountyRunExecution:
    """Production convenience entrypoint. No in-memory or insecure fallback."""

    endpoint = os.getenv("CB_CAP_EVIDENCE_GATEWAY_URL", "").strip()
    if not endpoint:
        raise RuntimeError("CB_CAP_EVIDENCE_GATEWAY_URL is required")
    gateway_client = EvidenceGatewayHttpClient(endpoint)

    with postgres_checkpointer(checkpoint_settings) as checkpointer:
        graph = build_county_planning_graph(checkpointer=checkpointer)
        with postgres_connection(
            persistence_settings,
            tenant_id=actor_tenant_id,
        ) as connection:
            return execute_county_run(
                run,
                budget,
                gateway_client,
                graph,
                connection,
                actor_tenant_id=actor_tenant_id,
                planning_pipeline_request=planning_pipeline_request,
            )
