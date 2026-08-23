from __future__ import annotations

import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterable, Protocol
from urllib.parse import parse_qs, urlparse

from .decision_memory import DecisionMemoryRecord
from .forecast_governance import (
    BacktestPolicyEvaluation,
    ForecastBacktestCase,
    ForecastBacktestPolicy,
    ForecastBacktestSummary,
    ForecastModelApproval,
    ForecastModelRegistration,
)
from .models import CountyRunState
from .trajectory import TrajectoryCorrection, TrajectoryEvaluationLabel, TrajectoryEvent


class CursorLike(Protocol):
    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> Any: ...


class ConnectionLike(Protocol):
    def cursor(self) -> Any: ...
    def commit(self) -> Any: ...
    def rollback(self) -> Any: ...


@dataclass(frozen=True)
class PersistenceSettings:
    database_url: str
    allow_insecure_database: bool = False

    @classmethod
    def from_env(cls) -> "PersistenceSettings":
        database_url = os.getenv("CB_CAP_DATABASE_URL", "").strip()
        if not database_url:
            raise RuntimeError("CB_CAP_DATABASE_URL is required for CB-CAP durable storage")
        allow_insecure = os.getenv("CB_CAP_ALLOW_INSECURE_DATABASE", "false").lower() == "true"
        return cls(database_url=database_url, allow_insecure_database=allow_insecure)

    def validate(self) -> None:
        parsed = urlparse(self.database_url)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise RuntimeError("CB-CAP durable storage must use PostgreSQL")
        if not parsed.hostname:
            raise RuntimeError("CB-CAP database URL must include a host")
        sslmode = (parse_qs(parsed.query).get("sslmode") or [""])[0].lower()
        if not self.allow_insecure_database and sslmode not in {"require", "verify-ca", "verify-full"}:
            raise RuntimeError(
                "CB-CAP durable storage must require TLS; set sslmode=require, verify-ca, or verify-full"
            )


@contextmanager
def postgres_connection(
    settings: PersistenceSettings | None = None,
    *,
    tenant_id: str | None = None,
):
    """Open a production PostgreSQL transaction with explicit tenant RLS scope.

    There is intentionally no SQLite or in-memory production fallback. The
    psycopg dependency is loaded only when production persistence is requested.
    """

    resolved = settings or PersistenceSettings.from_env()
    resolved.validate()
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError(
            "Install cbcap-core[production] to use PostgreSQL persistence"
        ) from exc

    with psycopg.connect(resolved.database_url) as connection:
        with connection.cursor() as cursor:
            _set_tenant_scope(cursor, tenant_id)
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise


def _outcome_class(outcome: str) -> str:
    normalized = outcome.strip().lower()
    if normalized in {"accepted", "admitted", "approved", "verified"}:
        return "accepted"
    if normalized in {"rejected", "declined"}:
        return "rejected"
    if normalized in {"review_required", "quarantined", "needs_revision", "waiting"}:
        return "review_required"
    if normalized in {"blocked", "incomplete", "missing_evidence", "cancelled"}:
        return "blocked"
    if normalized in {
        "completed",
        "complete",
        "complete_no_designations",
        "county_shortage",
        "scoped_context",
        "ready",
    }:
        return "completed"
    if normalized in {"error", "failed"}:
        return "error"
    return "unknown"


def _canonical_stage(stage: str) -> str:
    if stage == "candidate_discovery":
        return "source_discovery"
    return stage


def canonicalize_trajectory_event(
    payload: dict[str, Any],
    run: CountyRunState,
) -> TrajectoryEvent:
    """Convert graph/pipeline trajectory payloads into the durable canonical contract."""

    if payload.get("run_id") != run.run_id:
        raise ValueError("trajectory event run_id does not match county run")

    if {
        "geography_id",
        "actor_type",
        "actor_name",
        "actor_version",
        "outcome_class",
    }.issubset(payload):
        event = TrajectoryEvent.model_validate(payload)
        if event.geography_id != run.county.id:
            raise ValueError("trajectory event geography does not match county run")
        if event.tenant_id != run.tenant_id:
            raise ValueError("trajectory event tenant does not match county run")
        return event

    stage = str(payload.get("stage", "")).strip()
    entity_id = str(payload.get("entity_id", "")).strip()
    outcome = str(payload.get("outcome", "")).strip()
    if not stage or not entity_id or not outcome:
        raise ValueError("trajectory payload requires stage, entity_id, and outcome")

    canonical_stage = _canonical_stage(stage)
    actor_name = (
        "cbcap.planning-pipeline"
        if canonical_stage in {"candidate_policy", "document_admission", "claim_admission", "source_discovery"}
        else "cbcap.county-planning-graph"
    )
    return TrajectoryEvent(
        id=str(payload.get("id", "")).strip()
        or f"{run.run_id}:{canonical_stage}:{entity_id}:{outcome}",
        run_id=run.run_id,
        tenant_id=run.tenant_id,
        geography_id=run.county.id,
        stage=canonical_stage,
        actor_type="deterministic",
        actor_name=actor_name,
        actor_version="v1",
        entity_id=entity_id,
        outcome=outcome,
        outcome_class=_outcome_class(outcome),
        reason_codes=sorted(set(payload.get("reason_codes") or [])),
        source_entity_ids=list(dict.fromkeys(payload.get("source_entity_ids") or [])),
        tool_names=list(dict.fromkeys(payload.get("tool_names") or [])),
        input_state_hash=payload.get("input_state_hash"),
        output_state_hash=payload.get("output_state_hash"),
        model_provider=None,
        model_name=None,
        input_tokens=0,
        output_tokens=0,
        estimated_cost_usd=0.0,
        occurred_at=payload.get("occurred_at"),
    )


def canonicalize_trajectory_events(
    payloads: Iterable[dict[str, Any]],
    run: CountyRunState,
) -> list[TrajectoryEvent]:
    events: dict[str, TrajectoryEvent] = {}
    for payload in payloads:
        event = canonicalize_trajectory_event(payload, run)
        existing = events.get(event.id)
        if existing is not None and existing != event:
            raise ValueError(f"trajectory event id collision with different payload: {event.id}")
        events[event.id] = event
    return list(events.values())


def _set_tenant_scope(cursor: CursorLike, tenant_id: str | None) -> None:
    tenant = "" if tenant_id is None else tenant_id.strip()
    if tenant_id is not None and not tenant:
        raise ValueError("tenant_id cannot be blank")
    cursor.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant,))


def _require_matching_tenant(
    record_tenant_id: str | None,
    actor_tenant_id: str | None,
    *,
    label: str,
) -> None:
    if record_tenant_id != actor_tenant_id:
        raise ValueError(f"{label} tenant does not match authenticated actor tenant")


def persist_trajectory_events(
    connection: ConnectionLike,
    events: Iterable[TrajectoryEvent],
    *,
    actor_tenant_id: str | None,
) -> int:
    """Append canonical trajectory events idempotently."""

    count = 0
    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, actor_tenant_id)
        for event in events:
            _require_matching_tenant(event.tenant_id, actor_tenant_id, label="trajectory event")
            cursor.execute(
                """
                INSERT INTO cbcap.trajectory_event (
                  id, run_id, tenant_id, geography_id, stage, actor_type,
                  actor_name, actor_version, entity_id, outcome, outcome_class,
                  reason_codes, source_entity_ids, tool_names,
                  input_state_hash, output_state_hash, model_provider, model_name,
                  input_tokens, output_tokens, estimated_cost_usd, occurred_at
                ) VALUES (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                  %s::jsonb,%s::jsonb,%s::jsonb,%s,%s,%s,%s,%s,%s,%s,%s
                )
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    event.id,
                    event.run_id,
                    event.tenant_id,
                    event.geography_id,
                    event.stage,
                    event.actor_type,
                    event.actor_name,
                    event.actor_version,
                    event.entity_id,
                    event.outcome,
                    event.outcome_class,
                    json.dumps(event.reason_codes),
                    json.dumps(event.source_entity_ids),
                    json.dumps(event.tool_names),
                    event.input_state_hash,
                    event.output_state_hash,
                    event.model_provider,
                    event.model_name,
                    event.input_tokens,
                    event.output_tokens,
                    event.estimated_cost_usd,
                    event.occurred_at,
                ),
            )
            count += 1
    return count


def persist_trajectory_evaluation_labels(
    connection: ConnectionLike,
    labels: Iterable[TrajectoryEvaluationLabel],
    *,
    actor_tenant_id: str | None,
) -> int:
    count = 0
    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, actor_tenant_id)
        for label in labels:
            _require_matching_tenant(label.tenant_id, actor_tenant_id, label="trajectory evaluation label")
            cursor.execute(
                """
                INSERT INTO cbcap.trajectory_evaluation_label (
                  id, trajectory_event_id, tenant_id, label, reason_codes,
                  evaluator_id, evaluator_type, evaluator_version, created_at
                ) VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    label.id,
                    label.trajectory_event_id,
                    label.tenant_id,
                    label.label,
                    json.dumps(label.reason_codes),
                    label.evaluator_id,
                    label.evaluator_type,
                    label.evaluator_version,
                    label.created_at,
                ),
            )
            count += 1
    return count


def persist_trajectory_corrections(
    connection: ConnectionLike,
    corrections: Iterable[TrajectoryCorrection],
    *,
    actor_tenant_id: str | None,
) -> int:
    count = 0
    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, actor_tenant_id)
        for correction in corrections:
            _require_matching_tenant(correction.tenant_id, actor_tenant_id, label="trajectory correction")
            cursor.execute(
                """
                INSERT INTO cbcap.trajectory_correction (
                  id, trajectory_event_id, tenant_id, corrected_entity_id,
                  correction_type, reason_codes, corrected_by, corrected_at
                ) VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    correction.id,
                    correction.trajectory_event_id,
                    correction.tenant_id,
                    correction.corrected_entity_id,
                    correction.correction_type,
                    json.dumps(correction.reason_codes),
                    correction.corrected_by,
                    correction.corrected_at,
                ),
            )
            count += 1
    return count


def persist_county_graph_trajectory(
    connection: ConnectionLike,
    graph_state: dict[str, Any],
    *,
    actor_tenant_id: str | None,
) -> list[TrajectoryEvent]:
    run = CountyRunState.model_validate(graph_state["county_run"])
    _require_matching_tenant(run.tenant_id, actor_tenant_id, label="county run")
    events = canonicalize_trajectory_events(graph_state.get("trajectory_events", []), run)
    persist_trajectory_events(connection, events, actor_tenant_id=actor_tenant_id)
    return events


def persist_decision_memory(
    connection: ConnectionLike,
    record: DecisionMemoryRecord,
    *,
    actor_tenant_id: str,
) -> None:
    _require_matching_tenant(record.tenant_id, actor_tenant_id, label="decision memory")
    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, actor_tenant_id)
        cursor.execute(
            """
            INSERT INTO cbcap.decision_memory (
              id, tenant_id, geography_id, decision_type, subject_type, subject_id,
              outcome, reason_codes, rationale, evidence_entity_ids,
              related_entity_ids, missing_requirements, decided_by, decided_at,
              status, applicability, supersedes_memory_id, expires_at
            ) VALUES (
              %s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s::jsonb,
              %s::jsonb,%s::jsonb,%s,%s,%s,%s,%s,%s
            )
            ON CONFLICT (id) DO NOTHING
            """,
            (
                record.id,
                record.tenant_id,
                record.geography_id,
                record.decision_type,
                record.subject_type,
                record.subject_id,
                record.outcome,
                json.dumps(record.reason_codes),
                record.rationale,
                json.dumps(record.evidence_entity_ids),
                json.dumps(record.related_entity_ids),
                json.dumps(record.missing_requirements),
                record.decided_by,
                record.decided_at,
                record.status,
                record.applicability,
                record.supersedes_memory_id,
                record.expires_at,
            ),
        )


def persist_forecast_model_registration(
    connection: ConnectionLike,
    registration: ForecastModelRegistration,
) -> None:
    """Persist one immutable global forecast implementation registration."""

    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, None)
        cursor.execute(
            """
            INSERT INTO cbcap.forecast_model_registration (
              model_version, model_family, implementation_ref, implementation_hash,
              supported_metric_semantics_ids, allowed_source_ids, minimum_points,
              maximum_horizon_days, intervals_required, registered_by, registered_at
            ) VALUES (%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s,%s,%s)
            ON CONFLICT (model_version) DO NOTHING
            """,
            (
                registration.model_version,
                registration.model_family,
                registration.implementation_ref,
                registration.implementation_hash,
                json.dumps(registration.supported_metric_semantics_ids),
                json.dumps(registration.allowed_source_ids),
                registration.minimum_points,
                registration.maximum_horizon_days,
                registration.intervals_required,
                registration.registered_by,
                registration.registered_at,
            ),
        )


def persist_forecast_backtest_cases(
    connection: ConnectionLike,
    cases: Iterable[ForecastBacktestCase],
) -> int:
    count = 0
    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, None)
        for case in cases:
            cursor.execute(
                """
                INSERT INTO cbcap.forecast_backtest_case (
                  id, model_version, metric_semantics_id, geography_id,
                  forecast_origin, horizon_end, training_measure_ids,
                  holdout_measure_id, predicted_value, actual_value,
                  interval_low, interval_high, executed_at, input_state_hash
                ) VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    case.id,
                    case.model_version,
                    case.metric_semantics_id,
                    case.geography_id,
                    case.forecast_origin,
                    case.horizon_end,
                    json.dumps(case.training_measure_ids),
                    case.holdout_measure_id,
                    case.predicted_value,
                    case.actual_value,
                    case.interval_low,
                    case.interval_high,
                    case.executed_at,
                    case.input_state_hash,
                ),
            )
            count += 1
    return count


def persist_forecast_backtest_summary(
    connection: ConnectionLike,
    summary: ForecastBacktestSummary,
) -> None:
    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, None)
        cursor.execute(
            """
            INSERT INTO cbcap.forecast_backtest_summary (
              id, model_version, metric_semantics_id, case_count, geography_count,
              mean_absolute_error, root_mean_squared_error, mean_signed_error,
              maximum_absolute_error, interval_case_count, interval_coverage,
              minimum_horizon_days, maximum_horizon_days, backtest_case_ids,
              computed_at, review_status
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                summary.id,
                summary.model_version,
                summary.metric_semantics_id,
                summary.case_count,
                summary.geography_count,
                summary.mean_absolute_error,
                summary.root_mean_squared_error,
                summary.mean_signed_error,
                summary.maximum_absolute_error,
                summary.interval_case_count,
                summary.interval_coverage,
                summary.minimum_horizon_days,
                summary.maximum_horizon_days,
                json.dumps(summary.backtest_case_ids),
                summary.computed_at,
                summary.review_status.value,
            ),
        )


def persist_forecast_backtest_policy(
    connection: ConnectionLike,
    policy: ForecastBacktestPolicy,
) -> None:
    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, None)
        cursor.execute(
            """
            INSERT INTO cbcap.forecast_backtest_policy (
              id, model_version, metric_semantics_id, minimum_cases,
              maximum_mean_absolute_error, maximum_root_mean_squared_error,
              maximum_absolute_mean_signed_error, minimum_interval_coverage,
              intervals_required, maximum_horizon_days, rationale,
              reviewed_by, reviewed_at, review_status
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                policy.id,
                policy.model_version,
                policy.metric_semantics_id,
                policy.minimum_cases,
                policy.maximum_mean_absolute_error,
                policy.maximum_root_mean_squared_error,
                policy.maximum_absolute_mean_signed_error,
                policy.minimum_interval_coverage,
                policy.intervals_required,
                policy.maximum_horizon_days,
                policy.rationale,
                policy.reviewed_by,
                policy.reviewed_at,
                policy.review_status.value,
            ),
        )


def persist_backtest_policy_evaluation(
    connection: ConnectionLike,
    evaluation: BacktestPolicyEvaluation,
) -> None:
    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, None)
        cursor.execute(
            """
            INSERT INTO cbcap.forecast_backtest_policy_evaluation (
              id, model_version, metric_semantics_id, summary_id, policy_id,
              status, reason_codes, evaluated_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                evaluation.id,
                evaluation.model_version,
                evaluation.metric_semantics_id,
                evaluation.summary_id,
                evaluation.policy_id,
                evaluation.status,
                json.dumps(evaluation.reason_codes),
                evaluation.evaluated_at,
            ),
        )


def persist_forecast_model_approval(
    connection: ConnectionLike,
    approval: ForecastModelApproval,
) -> None:
    with connection.cursor() as cursor:
        _set_tenant_scope(cursor, None)
        cursor.execute(
            """
            INSERT INTO cbcap.forecast_model_approval (
              id, model_version, metric_semantics_id, policy_id,
              backtest_summary_id, policy_evaluation_id, decision, reason_codes,
              decided_by, decided_at, valid_from, valid_until, review_status
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                approval.id,
                approval.model_version,
                approval.metric_semantics_id,
                approval.policy_id,
                approval.backtest_summary_id,
                approval.policy_evaluation_id,
                approval.decision,
                json.dumps(approval.reason_codes),
                approval.decided_by,
                approval.decided_at,
                approval.valid_from,
                approval.valid_until,
                approval.review_status.value,
            ),
        )
