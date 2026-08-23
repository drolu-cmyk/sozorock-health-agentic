from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .graph import RunBudget
from .models import CountyRunState, RunStatus, StrictModel
from .persistence import ConnectionLike

RunObservationPhase = Literal["initial", "review_resume"]


class RunObservation(StrictModel):
    """Operational metadata only; never source prose or tenant document content."""

    id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    tenant_id: str | None = None
    geography_id: str = Field(min_length=1)
    phase: RunObservationPhase
    status: RunStatus
    evidence_release_id: str | None = None
    evidence_release_hash: str | None = Field(
        default=None,
        pattern=r"^sha256:[0-9a-fA-F]{64}$",
    )
    requested_at: datetime | None = None
    started_at: datetime
    completed_at: datetime
    queue_wait_ms: int | None = Field(default=None, ge=0)
    request_clock_skew_detected: bool = False
    evidence_fetch_ms: int | None = Field(default=None, ge=0)
    graph_duration_ms: int = Field(ge=0)
    total_duration_ms: int = Field(ge=0)
    external_calls_used: int = Field(ge=0)
    model_tokens_used: int = Field(ge=0)
    model_cost_usd: float = Field(ge=0)
    interrupted: bool
    review_count: int = Field(ge=0)
    review_intervention: bool

    @model_validator(mode="after")
    def validate_phase(self) -> "RunObservation":
        if self.completed_at < self.started_at:
            raise ValueError("run observation completed_at cannot precede started_at")
        if self.phase == "review_resume": (
            self._require_resume_fields_absent()
        )
        if self.phase == "initial" and self.requested_at is None:
            raise ValueError("initial run observation requires requested_at")
        return self

    def _require_resume_fields_absent(self) -> None:
        if self.evidence_fetch_ms is not None:
            raise ValueError("review-resume observation cannot report evidence fetch latency")
        if self.evidence_release_id is not None or self.evidence_release_hash is not None:
            raise ValueError("review-resume observation cannot claim a new evidence release")
        if self.queue_wait_ms is not None or self.requested_at is not None:
            raise ValueError("review-resume observation does not use initial queue-wait fields")


def _observation_id(payload: dict) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return "run-observation:sha256:" + hashlib.sha256(encoded).hexdigest()


def _queue_wait(started_at: datetime, requested_at: datetime) -> tuple[int, bool]:
    milliseconds = int(round((started_at - requested_at).total_seconds() * 1000))
    if milliseconds < 0:
        return 0, True
    return milliseconds, False


def build_initial_run_observation(
    source_run: CountyRunState,
    final_run: CountyRunState,
    budget: RunBudget,
    *,
    started_at: datetime,
    completed_at: datetime,
    evidence_fetch_ms: int,
    graph_duration_ms: int,
    total_duration_ms: int,
    evidence_release_id: str,
    evidence_release_hash: str,
    interrupted: bool,
) -> RunObservation:
    queue_wait_ms, clock_skew = _queue_wait(started_at, source_run.requested_at)
    payload = {
        "run_id": final_run.run_id,
        "tenant_id": final_run.tenant_id,
        "geography_id": final_run.county.id,
        "phase": "initial",
        "status": final_run.status.value,
        "evidence_release_id": evidence_release_id,
        "evidence_release_hash": evidence_release_hash,
        "requested_at": source_run.requested_at.isoformat(),
        "started_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "queue_wait_ms": queue_wait_ms,
        "request_clock_skew_detected": clock_skew,
        "evidence_fetch_ms": evidence_fetch_ms,
        "graph_duration_ms": graph_duration_ms,
        "total_duration_ms": total_duration_ms,
        "external_calls_used": budget.external_calls_used,
        "model_tokens_used": budget.model_tokens_used,
        "model_cost_usd": budget.model_cost_usd,
        "interrupted": interrupted,
        "review_count": len(final_run.reviews),
        "review_intervention": interrupted or bool(final_run.reviews),
    }
    return RunObservation(id=_observation_id(payload), **payload)


def build_review_resume_observation(
    final_run: CountyRunState,
    budget: RunBudget,
    *,
    started_at: datetime,
    completed_at: datetime,
    graph_duration_ms: int,
    total_duration_ms: int,
    interrupted: bool,
) -> RunObservation:
    payload = {
        "run_id": final_run.run_id,
        "tenant_id": final_run.tenant_id,
        "geography_id": final_run.county.id,
        "phase": "review_resume",
        "status": final_run.status.value,
        "evidence_release_id": None,
        "evidence_release_hash": None,
        "requested_at": None,
        "started_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "queue_wait_ms": None,
        "request_clock_skew_detected": False,
        "evidence_fetch_ms": None,
        "graph_duration_ms": graph_duration_ms,
        "total_duration_ms": total_duration_ms,
        "external_calls_used": budget.external_calls_used,
        "model_tokens_used": budget.model_tokens_used,
        "model_cost_usd": budget.model_cost_usd,
        "interrupted": interrupted,
        "review_count": len(final_run.reviews),
        "review_intervention": True,
    }
    return RunObservation(id=_observation_id(payload), **payload)


def persist_run_observation(
    connection: ConnectionLike,
    observation: RunObservation,
) -> None:
    with connection.cursor() as cursor:
        tenant_scope = "" if observation.tenant_id is None else observation.tenant_id
        cursor.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant_scope,))
        cursor.execute(
            """
            INSERT INTO cbcap.run_observation (
              id, run_id, tenant_id, geography_id, phase, status,
              evidence_release_id, evidence_release_hash, requested_at,
              started_at, completed_at, queue_wait_ms,
              request_clock_skew_detected, evidence_fetch_ms,
              graph_duration_ms, total_duration_ms, external_calls_used,
              model_tokens_used, model_cost_usd, interrupted,
              review_count, review_intervention
            ) VALUES (
              %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
            )
            ON CONFLICT (id) DO NOTHING
            """,
            (
                observation.id,
                observation.run_id,
                observation.tenant_id,
                observation.geography_id,
                observation.phase,
                observation.status.value,
                observation.evidence_release_id,
                observation.evidence_release_hash,
                observation.requested_at,
                observation.started_at,
                observation.completed_at,
                observation.queue_wait_ms,
                observation.request_clock_skew_detected,
                observation.evidence_fetch_ms,
                observation.graph_duration_ms,
                observation.total_duration_ms,
                observation.external_calls_used,
                observation.model_tokens_used,
                observation.model_cost_usd,
                observation.interrupted,
                observation.review_count,
                observation.review_intervention,
            ),
        )
