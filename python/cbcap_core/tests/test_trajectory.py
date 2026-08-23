from datetime import datetime, timezone

import pytest

from cbcap_core.trajectory import (
    TrajectoryCorrection,
    TrajectoryEvaluationLabel,
    TrajectoryEvent,
)

NOW = datetime(2026, 8, 22, 23, 15, tzinfo=timezone.utc)


def deterministic_event(**updates) -> TrajectoryEvent:
    payload = {
        "id": "trajectory:run-1:barrier:1",
        "run_id": "run-1",
        "tenant_id": "tenant-a",
        "geography_id": "county:36001",
        "stage": "barrier_classification",
        "actor_type": "deterministic",
        "actor_name": "barrier-classifier",
        "actor_version": "v1",
        "entity_id": "measure:transportation",
        "outcome": "admitted",
        "outcome_class": "accepted",
        "reason_codes": ["measure_in_barrier_ontology"],
        "source_entity_ids": ["measure:transportation"],
        "tool_names": [],
        "input_tokens": 0,
        "output_tokens": 0,
        "estimated_cost_usd": 0,
        "occurred_at": NOW,
    }
    payload.update(updates)
    return TrajectoryEvent(**payload)


def test_deterministic_event_can_record_zero_token_decision_path():
    event = deterministic_event()
    assert event.actor_type == "deterministic"
    assert event.input_tokens == 0
    assert event.estimated_cost_usd == 0


def test_deterministic_event_cannot_hide_model_usage_or_identity():
    with pytest.raises(ValueError, match="deterministic"):
        deterministic_event(
            model_provider="openai",
            model_name="controlled-model",
            input_tokens=100,
        )

    with pytest.raises(ValueError, match="deterministic"):
        deterministic_event(
            model_provider="openai",
            model_name="controlled-model",
        )


def test_model_cost_requires_complete_model_identity():
    with pytest.raises(ValueError, match="model identity"):
        deterministic_event(
            actor_type="agent",
            model_provider="openai",
            estimated_cost_usd=0.25,
        )

    with pytest.raises(ValueError, match="model identity"):
        deterministic_event(
            actor_type="agent",
            model_name="controlled-model",
            estimated_cost_usd=0.25,
        )

    event = deterministic_event(
        actor_type="agent",
        model_provider="openai",
        model_name="controlled-model",
        input_tokens=100,
        output_tokens=25,
        estimated_cost_usd=0.25,
    )
    assert event.model_provider == "openai"
    assert event.model_name == "controlled-model"


def test_evaluation_label_does_not_mutate_original_trajectory():
    event = deterministic_event()
    label = TrajectoryEvaluationLabel(
        id="label:trajectory:run-1:1",
        trajectory_event_id=event.id,
        tenant_id=event.tenant_id,
        label="incorrect",
        reason_codes=["scope_error"],
        evaluator_id="eval:reviewer",
        evaluator_type="human",
        evaluator_version="review-policy-v1",
        created_at=NOW,
    )
    assert event.outcome == "admitted"
    assert label.trajectory_event_id == event.id
    assert label.label == "incorrect"


def test_correction_is_append_only_and_explicit_about_corrected_entity():
    event = deterministic_event()
    correction = TrajectoryCorrection(
        id="correction:trajectory:run-1:1",
        trajectory_event_id=event.id,
        tenant_id=event.tenant_id,
        corrected_entity_id="measure:transportation",
        correction_type="classification",
        reason_codes=["context_not_barrier"],
        corrected_by="reviewer@example.org",
        corrected_at=NOW,
    )
    assert correction.corrected_entity_id == "measure:transportation"
    assert correction.correction_type == "classification"
