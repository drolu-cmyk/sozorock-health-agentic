from datetime import date, datetime, timezone

from cbcap_core import (
    ForecastBacktestCase,
    ForecastBacktestPolicy,
    ForecastModelApproval,
    ForecastModelRegistration,
    evaluate_backtest_policy,
    persist_backtest_policy_evaluation,
    persist_forecast_backtest_cases,
    persist_forecast_backtest_policy,
    persist_forecast_backtest_summary,
    persist_forecast_model_approval,
    persist_forecast_model_registration,
    summarize_backtests,
)

NOW = datetime(2026, 8, 22, 23, 45, tzinfo=timezone.utc)
MODEL = "cbcap-statistical-test-v1"
METRIC = "metric:transportation"
SOURCE = "cdc-places"


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


def registration() -> ForecastModelRegistration:
    return ForecastModelRegistration(
        model_version=MODEL,
        model_family="statistical",
        implementation_ref="cbcap.forecast.transportation.test.v1",
        implementation_hash="sha256:" + "a" * 64,
        supported_metric_semantics_ids=[METRIC],
        allowed_source_ids=[SOURCE],
        minimum_points=4,
        maximum_horizon_days=730,
        intervals_required=True,
        registered_by="forecast-governance:test",
        registered_at=NOW,
    )


def cases() -> list[ForecastBacktestCase]:
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
        for fips, predicted, actual, low, high in [
            ("36001", 9.5, 10.0, 9.0, 10.5),
            ("42029", 11.2, 11.0, 10.0, 12.0),
            ("48029", 13.0, 12.0, 12.5, 13.5),
        ]
    ]


def policy() -> ForecastBacktestPolicy:
    return ForecastBacktestPolicy(
        id="forecast-policy:test:v1",
        model_version=MODEL,
        metric_semantics_id=METRIC,
        minimum_cases=3,
        maximum_mean_absolute_error=1.0,
        maximum_root_mean_squared_error=1.0,
        maximum_absolute_mean_signed_error=1.0,
        minimum_interval_coverage=0.60,
        intervals_required=True,
        maximum_horizon_days=400,
        rationale="Synthetic persistence test policy only.",
        reviewed_by="forecast-governance:test",
        reviewed_at=NOW,
    )


def governance_chain():
    backtests = cases()
    summary = summarize_backtests(backtests, computed_at=NOW)
    selected_policy = policy()
    evaluation = evaluate_backtest_policy(summary, selected_policy, evaluated_at=NOW)
    approval = ForecastModelApproval(
        id="forecast-approval:test:v1",
        model_version=MODEL,
        metric_semantics_id=METRIC,
        policy_id=selected_policy.id,
        backtest_summary_id=summary.id,
        policy_evaluation_id=evaluation.id,
        decision="approved",
        reason_codes=["controlled_test_approval"],
        decided_by="forecast-governance:test",
        decided_at=NOW,
        valid_from=date(2026, 8, 22),
        valid_until=date(2027, 8, 22),
    )
    return backtests, summary, selected_policy, evaluation, approval


def assert_global_scope_then_insert(connection: FakeConnection, table_name: str):
    assert connection.executions[0][0].startswith("SELECT set_config('app.tenant_id'")
    assert connection.executions[0][1] == ("",)
    assert f"INSERT INTO cbcap.{table_name}" in connection.executions[1][0]
    assert "DO NOTHING" in connection.executions[1][0]
    assert "DO UPDATE" not in connection.executions[1][0]


def test_forecast_model_registration_is_global_and_immutable_on_conflict():
    connection = FakeConnection()
    persist_forecast_model_registration(connection, registration())
    assert_global_scope_then_insert(connection, "forecast_model_registration")


def test_forecast_backtest_cases_clear_tenant_scope_and_do_not_write_generated_errors():
    connection = FakeConnection()
    written = persist_forecast_backtest_cases(connection, cases())
    assert written == 3
    assert connection.executions[0][1] == ("",)
    first_insert = connection.executions[1][0]
    assert "INSERT INTO cbcap.forecast_backtest_case" in first_insert
    assert "signed_error" not in first_insert
    assert "absolute_error" not in first_insert
    assert "squared_error" not in first_insert
    assert "ON CONFLICT (id) DO NOTHING" in first_insert


def test_forecast_summary_policy_evaluation_and_approval_are_separate_immutable_records():
    backtests, summary, selected_policy, evaluation, approval = governance_chain()

    cases_connection = FakeConnection()
    summary_connection = FakeConnection()
    policy_connection = FakeConnection()
    evaluation_connection = FakeConnection()
    approval_connection = FakeConnection()

    persist_forecast_backtest_cases(cases_connection, backtests)
    persist_forecast_backtest_summary(summary_connection, summary)
    persist_forecast_backtest_policy(policy_connection, selected_policy)
    persist_backtest_policy_evaluation(evaluation_connection, evaluation)
    persist_forecast_model_approval(approval_connection, approval)

    assert_global_scope_then_insert(summary_connection, "forecast_backtest_summary")
    assert_global_scope_then_insert(policy_connection, "forecast_backtest_policy")
    assert_global_scope_then_insert(evaluation_connection, "forecast_backtest_policy_evaluation")
    assert_global_scope_then_insert(approval_connection, "forecast_model_approval")

    evaluation_params = evaluation_connection.executions[1][1]
    approval_params = approval_connection.executions[1][1]
    assert evaluation.id in evaluation_params
    assert evaluation.id in approval_params
    assert summary.id in approval_params
    assert selected_policy.id in approval_params
