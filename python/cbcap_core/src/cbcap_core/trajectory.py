from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .models import StrictModel

TrajectoryStage = Literal[
    "geography_resolution",
    "source_discovery",
    "candidate_policy",
    "document_admission",
    "claim_admission",
    "public_evidence",
    "barrier_classification",
    "workforce_classification",
    "workforce_scope",
    "workforce_capacity",
    "workforce_source_coverage",
    "funding_source_validation",
    "funding_criterion",
    "funding_fit",
    "forecast_authorization",
    "scenario_projection",
    "evidence_graph_validation",
    "human_review",
    "publication_gate",
]
TrajectoryActorType = Literal["deterministic", "agent", "reviewer", "system"]
TrajectoryOutcomeClass = Literal[
    "accepted",
    "rejected",
    "blocked",
    "review_required",
    "completed",
    "unknown",
    "error",
]


class TrajectoryEvent(StrictModel):
    """Structured evaluation event with no raw external content field."""

    id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    tenant_id: str | None = None
    geography_id: str = Field(min_length=1)
    stage: TrajectoryStage
    actor_type: TrajectoryActorType
    actor_name: str = Field(min_length=1)
    actor_version: str = Field(min_length=1)
    entity_id: str = Field(min_length=1)
    outcome: str = Field(min_length=1)
    outcome_class: TrajectoryOutcomeClass
    reason_codes: list[str] = Field(default_factory=list)
    source_entity_ids: list[str] = Field(default_factory=list)
    tool_names: list[str] = Field(default_factory=list)
    input_state_hash: str | None = None
    output_state_hash: str | None = None
    model_provider: str | None = None
    model_name: str | None = None
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    estimated_cost_usd: float = Field(default=0.0, ge=0)
    occurred_at: datetime

    @model_validator(mode="after")
    def validate_model_accounting(self) -> "TrajectoryEvent":
        has_provider = self.model_provider is not None
        has_model = self.model_name is not None
        if has_provider != has_model:
            raise ValueError("model identity requires both provider and model name")

        model_used = has_provider and has_model
        token_or_cost_used = (
            self.input_tokens > 0
            or self.output_tokens > 0
            or self.estimated_cost_usd > 0
        )
        if token_or_cost_used and not model_used:
            raise ValueError("model token or cost accounting requires model identity")
        if self.actor_type == "deterministic" and (model_used or token_or_cost_used):
            raise ValueError(
                "deterministic trajectory events cannot report model identity, tokens, or model cost"
            )
        return self


class TrajectoryEvaluationLabel(StrictModel):
    """Human or evaluator judgment attached without mutating the original event."""

    id: str = Field(min_length=1)
    trajectory_event_id: str = Field(min_length=1)
    tenant_id: str | None = None
    label: Literal[
        "correct",
        "incorrect",
        "incomplete",
        "unsafe",
        "source_error",
        "scope_error",
        "needs_human_judgment",
    ]
    reason_codes: list[str] = Field(min_length=1)
    evaluator_id: str = Field(min_length=1)
    evaluator_type: Literal["human", "deterministic_eval", "model_eval"]
    evaluator_version: str = Field(min_length=1)
    created_at: datetime


class TrajectoryCorrection(StrictModel):
    """Append-only correction used to build golden evaluation data."""

    id: str = Field(min_length=1)
    trajectory_event_id: str = Field(min_length=1)
    tenant_id: str | None = None
    corrected_entity_id: str = Field(min_length=1)
    correction_type: Literal[
        "source_selection",
        "geography_scope",
        "extraction",
        "classification",
        "eligibility",
        "forecast_assumption",
        "review_decision",
        "other",
    ]
    reason_codes: list[str] = Field(min_length=1)
    corrected_by: str = Field(min_length=1)
    corrected_at: datetime
