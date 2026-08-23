import cbcap_core
from cbcap_core import decision_memory, institutional_memory


def test_package_exports_governed_memory_trajectory_forecast_and_runtime_surface():
    required = {
        "DecisionMemoryRecord",
        "DecisionMemoryProposal",
        "DecisionMemoryWriteRequest",
        "DecisionMemoryQuery",
        "TrajectoryEvent",
        "TrajectoryEvaluationLabel",
        "TrajectoryCorrection",
        "PersistenceSettings",
        "postgres_connection",
        "canonicalize_trajectory_event",
        "persist_county_graph_trajectory",
        "persist_trajectory_events",
        "persist_trajectory_evaluation_labels",
        "persist_trajectory_corrections",
        "persist_decision_memory",
        "FundingFitReviewResult",
        "apply_funding_fit_review",
        "FundingPursuitDecisionRequest",
        "FundingPursuitDecisionResult",
        "build_funding_pursuit_decision",
        "ForecastModelRegistration",
        "ForecastBacktestCase",
        "ForecastBacktestSummary",
        "ForecastBacktestPolicy",
        "BacktestPolicyEvaluation",
        "ForecastModelApproval",
        "ForecastModelExecutionDecision",
        "summarize_backtests",
        "evaluate_backtest_policy",
        "authorize_forecast_model_execution",
        "persist_forecast_model_registration",
        "persist_forecast_backtest_cases",
        "persist_forecast_backtest_summary",
        "persist_forecast_backtest_policy",
        "persist_backtest_policy_evaluation",
        "persist_forecast_model_approval",
        "EvidenceGatewayHttpClient",
        "EvidenceGatewayTransportError",
        "EvidenceGatewayFetchResult",
        "validate_gateway_http_document",
        "package_release_hash",
        "PreparedCountyGraphRun",
        "CountyRunPreparationError",
        "prepare_county_graph_run",
        "CountyRunExecution",
        "RuntimeActor",
        "RuntimeRole",
        "execute_county_run",
        "execute_county_run_from_env",
        "resume_county_run_review",
    }
    missing = sorted(name for name in required if not hasattr(cbcap_core, name))
    assert missing == []


def test_institutional_memory_compatibility_module_reexports_canonical_models():
    assert institutional_memory.DecisionMemoryRecord is decision_memory.DecisionMemoryRecord
    assert institutional_memory.DecisionMemoryProposal is decision_memory.DecisionMemoryProposal
    assert institutional_memory.build_decision_memory is decision_memory.build_decision_memory
    assert institutional_memory.supersede_decision_memory is decision_memory.supersede_decision_memory
