from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .authorization import AuthorizedActor
from .gateway_transport import EvidenceGatewayHttpClient
from .graph import RunBudget
from .models import CountyRunState
from .observability import (
    OperationalGuardrailBudget,
    OperationalGuardrailDecision,
    RunTelemetrySummary,
    build_run_telemetry,
    evaluate_operational_guardrails,
    persist_run_telemetry,
)
from .persistence import ConnectionLike
from .runtime_service import (
    CompiledGraphLike,
    CountyRunExecution,
    execute_county_run,
    resume_county_run_review,
)


@dataclass(frozen=True)
class ObservedCountyRunExecution:
    execution: CountyRunExecution
    telemetry: RunTelemetrySummary
    guardrails: OperationalGuardrailDecision | None = None


def _final_budget(execution: CountyRunExecution, fallback: RunBudget) -> RunBudget:
    payload = execution.graph_state.get("budget")
    if payload is not None:
        return RunBudget.model_validate(payload)
    if execution.prepared is not None:
        return execution.prepared.budget
    return fallback


def _canonical_run(execution: CountyRunExecution) -> CountyRunState:
    payload = execution.graph_state.get("county_run")
    if payload is None:
        raise RuntimeError("county execution returned no canonical county_run state")
    return CountyRunState.model_validate(payload)


def _source_release(execution: CountyRunExecution) -> tuple[str | None, str | None]:
    if execution.prepared is None:
        return None, None
    manifest = execution.prepared.gateway_response.manifest
    return manifest.release_id, manifest.release_hash


def _build_summary(
    *,
    started_at: datetime,
    completed_at: datetime,
    run: CountyRunState,
    budget: RunBudget,
    execution: CountyRunExecution,
    failure_reason: str | None = None,
) -> RunTelemetrySummary:
    release_id, release_hash = _source_release(execution)
    return build_run_telemetry(
        started_at=started_at,
        completed_at=completed_at,
        run=run,
        budget=budget,
        trajectory_events=execution.trajectory_events,
        source_release_id=release_id,
        source_release_hash=release_hash,
        failure_reason=failure_reason,
    )


def _safe_failure_telemetry(
    connection: ConnectionLike,
    *,
    actor: AuthorizedActor,
    started_at: datetime,
    failed_at: datetime,
    run: CountyRunState,
    budget: RunBudget,
    failure: BaseException,
) -> None:
    """Best-effort failure telemetry without replacing the original exception.

    Only the exception class is persisted. Arbitrary exception messages can
    contain URLs, credentials, source prose, or tenant-private content and are
    intentionally excluded from operational telemetry.
    """

    synthetic = CountyRunExecution(
        graph_state={"county_run": run.model_dump(mode="json"), "budget": budget.model_dump(mode="json")},
        interrupted=False,
        trajectory_events=[],
        prepared=None,
    )
    try:
        summary = _build_summary(
            started_at=started_at,
            completed_at=failed_at,
            run=run,
            budget=budget,
            execution=synthetic,
            failure_reason=type(failure).__name__,
        )
        persist_run_telemetry(
            connection,
            summary,
            actor_tenant_id=actor.tenant_id,
        )
    except Exception as telemetry_error:
        add_note = getattr(failure, "add_note", None)
        if callable(add_note):
            add_note(
                "CB-CAP failure telemetry could not be persisted: "
                + type(telemetry_error).__name__
            )


def execute_observed_county_run(
    run: CountyRunState,
    budget: RunBudget,
    gateway_client: EvidenceGatewayHttpClient,
    graph: CompiledGraphLike,
    connection: ConnectionLike,
    *,
    actor: AuthorizedActor,
    planning_pipeline_request: dict[str, Any] | None = None,
    etag: str | None = None,
    cached_response=None,
    guardrail_budget: OperationalGuardrailBudget | None = None,
) -> ObservedCountyRunExecution:
    """Execute one county run and append one truthful run-level telemetry record."""

    started_at = datetime.now(timezone.utc)
    try:
        execution = execute_county_run(
            run,
            budget,
            gateway_client,
            graph,
            connection,
            actor=actor,
            planning_pipeline_request=planning_pipeline_request,
            etag=etag,
            cached_response=cached_response,
        )
    except Exception as exc:
        _safe_failure_telemetry(
            connection,
            actor=actor,
            started_at=started_at,
            failed_at=datetime.now(timezone.utc),
            run=run,
            budget=budget,
            failure=exc,
        )
        raise

    completed_at = datetime.now(timezone.utc)
    canonical_run = _canonical_run(execution)
    final_budget = _final_budget(execution, budget)
    summary = _build_summary(
        started_at=started_at,
        completed_at=completed_at,
        run=canonical_run,
        budget=final_budget,
        execution=execution,
    )
    persist_run_telemetry(
        connection,
        summary,
        actor_tenant_id=actor.tenant_id,
    )
    guardrails = (
        evaluate_operational_guardrails(summary, guardrail_budget)
        if guardrail_budget is not None
        else None
    )
    return ObservedCountyRunExecution(
        execution=execution,
        telemetry=summary,
        guardrails=guardrails,
    )


def resume_observed_county_run_review(
    run_id: str,
    graph: CompiledGraphLike,
    connection: ConnectionLike,
    *,
    actor: AuthorizedActor,
    decision: str,
    reason: str,
    guardrail_budget: OperationalGuardrailBudget | None = None,
) -> ObservedCountyRunExecution:
    """Resume a reviewed run and record the resumed execution as a separate telemetry sample."""

    started_at = datetime.now(timezone.utc)
    execution = resume_county_run_review(
        run_id,
        graph,
        connection,
        actor=actor,
        decision=decision,
        reason=reason,
    )
    completed_at = datetime.now(timezone.utc)
    canonical_run = _canonical_run(execution)
    final_budget = _final_budget(execution, RunBudget())
    summary = _build_summary(
        started_at=started_at,
        completed_at=completed_at,
        run=canonical_run,
        budget=final_budget,
        execution=execution,
    )
    persist_run_telemetry(
        connection,
        summary,
        actor_tenant_id=actor.tenant_id,
    )
    guardrails = (
        evaluate_operational_guardrails(summary, guardrail_budget)
        if guardrail_budget is not None
        else None
    )
    return ObservedCountyRunExecution(
        execution=execution,
        telemetry=summary,
        guardrails=guardrails,
    )
