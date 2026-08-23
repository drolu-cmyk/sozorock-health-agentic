BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cbcap.forecast_model_approval LIMIT 1)
    OR EXISTS (SELECT 1 FROM cbcap.forecast_backtest_policy_evaluation LIMIT 1)
    OR EXISTS (SELECT 1 FROM cbcap.forecast_backtest_policy LIMIT 1)
    OR EXISTS (SELECT 1 FROM cbcap.forecast_backtest_summary LIMIT 1)
    OR EXISTS (SELECT 1 FROM cbcap.forecast_backtest_case LIMIT 1)
    OR EXISTS (SELECT 1 FROM cbcap.forecast_model_registration LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing to drop CB-CAP forecast governance history because model, backtest, policy, evaluation, or approval records exist. Export or migrate them explicitly before rollback.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS forecast_model_approval_guard
  ON cbcap.forecast_model_approval;
DROP TRIGGER IF EXISTS forecast_policy_evaluation_guard
  ON cbcap.forecast_backtest_policy_evaluation;
DROP TRIGGER IF EXISTS forecast_backtest_summary_case_guard
  ON cbcap.forecast_backtest_summary;

DROP TRIGGER IF EXISTS forecast_model_approval_append_only
  ON cbcap.forecast_model_approval;
DROP TRIGGER IF EXISTS forecast_policy_evaluation_append_only
  ON cbcap.forecast_backtest_policy_evaluation;
DROP TRIGGER IF EXISTS forecast_backtest_policy_append_only
  ON cbcap.forecast_backtest_policy;
DROP TRIGGER IF EXISTS forecast_backtest_summary_append_only
  ON cbcap.forecast_backtest_summary;
DROP TRIGGER IF EXISTS forecast_backtest_case_append_only
  ON cbcap.forecast_backtest_case;
DROP TRIGGER IF EXISTS forecast_model_registration_append_only
  ON cbcap.forecast_model_registration;

DROP TABLE IF EXISTS cbcap.forecast_model_approval;
DROP TABLE IF EXISTS cbcap.forecast_backtest_policy_evaluation;
DROP TABLE IF EXISTS cbcap.forecast_backtest_policy;
DROP TABLE IF EXISTS cbcap.forecast_backtest_summary;
DROP TABLE IF EXISTS cbcap.forecast_backtest_case;
DROP TABLE IF EXISTS cbcap.forecast_model_registration;

DROP FUNCTION IF EXISTS cbcap.validate_forecast_model_approval();
DROP FUNCTION IF EXISTS cbcap.validate_forecast_policy_evaluation();
DROP FUNCTION IF EXISTS cbcap.validate_forecast_backtest_summary_cases();

COMMIT;
