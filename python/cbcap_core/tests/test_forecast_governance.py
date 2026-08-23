from datetime import date, datetime, timezone

import pytest

from cbcap_core.forecast_governance import (
    BacktestPolicyEvaluation,
    ForecastBacktestCase,
    ForecastBacktestPolicy,
    ForecastModelApproval,
    ForecastModelRegistration,
    authorize_forecast_model_execution,
    evaluate_backtest_policy,
    summarize_backtests,
)

NOW = datetime(2026, 8, 22, 23, 30, tzinfo=timezone.utc)
MODEL = "cbcap-statistical-demo-v1"
METRIC = "metric:transportation"
SOURCE = "cdc-places"


def registration() -> ForecastModelRegistration:
    return ForecastModelRegistration(
        model_version=MODEL,
        model_family="statistical",
        implementation_ref="cbcap.forecast.transportation.v1",
        implementation_hash="sha256:" + "a" * 64,
        supported_metric_semantics_ids=[METRIC],
        allowed_source_ids=[SOURCE],
        minimum_points=4,
        maximum_horizon_days=730,
        intervals_required=True,
        registered_by="model-governance:reviewer",
        registered_at=NOW,
    )


def backtest_cases() -> list[ForecastBacktestCase]:
    values = [
        ("36001", 9.5, 10.0, 9.0, 10.5),
        ("42029", 11.2, 11.0, 10.0, 12.0),
        ("48029", 13.0, 12.0, 12.5, 13.5),
    ]
    return [
        ForecastBacktestCase(
            id=f"backtest:{fips}",
            model_version=MODEL,
            metric_semantics_id=METRIC,
            geography_id=f"county:{fips}",
            forecast_origin=date(2024, 12, 31),
            horizon_end=date(2025, 12, 31),
            training_measure_ids=[
                f"measure:{fips}:2021",
                f"measure:{fips}:2022",
                f"measure:{fips}:2023",
                f"measure:{fips}:2024",
            ],
            holdout_measure_id=f"measure:{fips}:2025",
            predicted_value=predicted,
            actual_value=actual,
            interval_low=low,
            interval_high=high,
            executed_at=NOW,
            input_state_hash="sha256:" + fips.ljust(64, "b"),
        )
        for fips, predicted, actual, low, high in values
    ]


def policy() -> ForecastBacktestPolicy:
    return ForecastBacktestPolicy(
        id="forecast-policy:transportation:v1",
        model_version=MODEL,
        metric_semantics_id=METRIC,
        minimum_cases=3,
        maximum_mean_absolute_error=0.7,
        maximum_root_mean_squared_error=0.8,
        maximum_absolute_mean_signed_error=0.4,
        minimum_interval_coverage=0.66,
        intervals_required=True,
        maximum_horizon_days=400,
        rationale="Controlled acceptance thresholds for this metric and model version only.",
        reviewed_by="forecast-governance:reviewer",
        reviewed_at=NOW,
    )


def evaluate(summary, selected_policy=None) -> BacktestPolicyEvaluation:
    return evaluate_backtest_policy(
        summary,
        selected_policy or policy(),
        evaluated_at=NOW,
    )


def approval(
    summary_id: str,
    policy_evaluation_id: str,
    *,
    decision: str = "approved",
) -> ForecastModelApproval:
    return ForecastModelApproval(
        id=f"forecast-approval:{MODEL}:{decision}",
        model_version=MODEL,
        metric_semantics_id=METRIC,
        policy_id=policy().id,
        backtest_summary_id=summary_id,
        policy_evaluation_id=policy_evaluation_id,
        decision=decision,
        reason_codes=[f"decision:{decision}"],
        decided_by="forecast-governance:reviewer",
        decided_at=NOW,
        valid_from=date(2026, 8, 22),
        valid_until=date(2027, 8, 22),
    )


def test_backtest_summary_uses_transparent_error_metrics_without_mape():
    summary = summarize_backtests(backtest_cases(), computed_at=NOW)
    assert summary.case_count == 3
    assert summary.geography_count == 3
    assert round(summary.mean_absolute_error, 6) == round((0.5 + 0.2 + 1.0) / 3, 6)
    assert round(summary.root_mean_squared_error, 6) == round(((0.25 + 0.04 + 1.0) / 3) ** 0.5, 6)
    assert round(summary.mean_signed_error, 6) == round((-0.5 + 0.2 + 1.0) / 3, 6)
    assert summary.interval_case_count == 3
    assert round(summary.interval_coverage or 0, 6) == round(2 / 3, 6)
    assert summary.review_status.value == "provisional"


def test_backtest_case_prevents_holdout_leakage():
    with pytest.raises(ValueError, match="holdout"):
        ForecastBacktestCase(
            id="backtest:leak",
            model_version=MODEL,
            metric_semantics_id=METRIC,
            geography_id="county:36001",
            forecast_origin=date(2024, 12, 31),
            horizon_end=date(2025, 12, 31),
            training_measure_ids=["measure:2025"],
            holdout_measure_id="measure:2025",
            predicted_value=10,
            actual_value=11,
            executed_at=NOW,
            input_state_hash="sha256:" + "c" * 64,
        )


def test_summary_cannot_mix_model_versions_or_metric_semantics():
    cases = backtest_cases()
    with pytest.raises(ValueError, match="model versions"):
        summarize_backtests(
            [cases[0], cases[1].model_copy(update={"model_version": "other-model"})],
            computed_at=NOW,
        )
    with pytest.raises(ValueError, match="metric semantics"):
        summarize_backtests(
            [cases[0], cases[1].model_copy(update={"metric_semantics_id": "metric:other"})],
            computed_at=NOW,
        )


def test_metric_specific_backtest_policy_passes_only_when_explicit_thresholds_pass():
    summary = summarize_backtests(backtest_cases(), computed_at=NOW)
    evaluation = evaluate(summary)
    assert evaluation.status == "passes"
    assert evaluation.reason_codes == []
    assert evaluation.id.startswith("backtest-evaluation:")
    assert evaluation.evaluated_at == NOW

    strict = policy().model_copy(update={"maximum_mean_absolute_error": 0.3})
    blocked = evaluate(summary, strict)
    assert blocked.status == "blocked"
    assert "mean_absolute_error_exceeds_policy" in blocked.reason_codes


def test_passing_backtest_does_not_authorize_model_without_separate_human_approval():
    summary = summarize_backtests(backtest_cases(), computed_at=NOW)
    evaluation = evaluate(summary)
    rejected = authorize_forecast_model_execution(
        registration(),
        evaluation,
        approval(summary.id, evaluation.id, decision="rejected"),
        metric_semantics_id=METRIC,
        source_id=SOURCE,
        as_of=date(2026, 8, 22),
        horizon_days=365,
    )
    assert rejected.status == "blocked"
    assert "model_not_human_approved" in rejected.reason_codes


def test_model_execution_requires_registration_backtest_policy_evaluation_and_current_approval_to_align():
    summary = summarize_backtests(backtest_cases(), computed_at=NOW)
    evaluation = evaluate(summary)
    approved = approval(summary.id, evaluation.id)
    decision = authorize_forecast_model_execution(
        registration(),
        evaluation,
        approved,
        metric_semantics_id=METRIC,
        source_id=SOURCE,
        as_of=date(2026, 8, 22),
        horizon_days=365,
    )
    assert decision.status == "ready"
    assert decision.reason_codes == []
    assert decision.backtest_summary_id == summary.id
    assert decision.policy_evaluation_id == evaluation.id

    mismatched_evaluation = approved.model_copy(update={"policy_evaluation_id": "evaluation:other"})
    mismatch = authorize_forecast_model_execution(
        registration(),
        evaluation,
        mismatched_evaluation,
        metric_semantics_id=METRIC,
        source_id=SOURCE,
        as_of=date(2026, 8, 22),
        horizon_days=365,
    )
    assert mismatch.status == "blocked"
    assert "approval_policy_evaluation_mismatch" in mismatch.reason_codes

    wrong_source = authorize_forecast_model_execution(
        registration(),
        evaluation,
        approved,
        metric_semantics_id=METRIC,
        source_id="ahrf-workforce",
        as_of=date(2026, 8, 22),
        horizon_days=365,
    )
    assert wrong_source.status == "blocked"
    assert "source_not_registered_for_model" in wrong_source.reason_codes

    expired = authorize_forecast_model_execution(
        registration(),
        evaluation,
        approved,
        metric_semantics_id=METRIC,
        source_id=SOURCE,
        as_of=date(2028, 1, 1),
        horizon_days=365,
    )
    assert expired.status == "blocked"
    assert "model_approval_expired" in expired.reason_codes
