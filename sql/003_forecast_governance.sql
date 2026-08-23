BEGIN;

CREATE SCHEMA IF NOT EXISTS cbcap;

CREATE TABLE IF NOT EXISTS cbcap.forecast_model_registration (
  model_version text PRIMARY KEY CHECK (length(btrim(model_version)) > 0),
  model_family text NOT NULL CHECK (model_family IN ('statistical', 'deterministic_scenario')),
  implementation_ref text NOT NULL CHECK (length(btrim(implementation_ref)) > 0),
  implementation_hash text NOT NULL CHECK (implementation_hash ~ '^sha256:[0-9a-fA-F]{64}$'),
  supported_metric_semantics_ids jsonb NOT NULL CHECK (
    jsonb_typeof(supported_metric_semantics_ids) = 'array'
    AND jsonb_array_length(supported_metric_semantics_ids) > 0
  ),
  allowed_source_ids jsonb NOT NULL CHECK (
    jsonb_typeof(allowed_source_ids) = 'array'
    AND jsonb_array_length(allowed_source_ids) > 0
  ),
  minimum_points integer NOT NULL CHECK (minimum_points >= 2),
  maximum_horizon_days integer NOT NULL CHECK (maximum_horizon_days > 0),
  intervals_required boolean NOT NULL,
  registered_by text NOT NULL CHECK (length(btrim(registered_by)) > 0),
  registered_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cbcap.forecast_backtest_case (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  model_version text NOT NULL REFERENCES cbcap.forecast_model_registration(model_version) ON DELETE RESTRICT,
  metric_semantics_id text NOT NULL CHECK (length(btrim(metric_semantics_id)) > 0),
  geography_id text NOT NULL CHECK (length(btrim(geography_id)) > 0),
  forecast_origin date NOT NULL,
  horizon_end date NOT NULL,
  training_measure_ids jsonb NOT NULL CHECK (
    jsonb_typeof(training_measure_ids) = 'array'
    AND jsonb_array_length(training_measure_ids) > 0
  ),
  holdout_measure_id text NOT NULL CHECK (length(btrim(holdout_measure_id)) > 0),
  predicted_value double precision NOT NULL,
  actual_value double precision NOT NULL,
  interval_low double precision NULL,
  interval_high double precision NULL,
  executed_at timestamptz NOT NULL,
  input_state_hash text NOT NULL CHECK (input_state_hash ~ '^sha256:[0-9a-fA-F]{64}$'),
  signed_error double precision GENERATED ALWAYS AS (predicted_value - actual_value) STORED,
  absolute_error double precision GENERATED ALWAYS AS (abs(predicted_value - actual_value)) STORED,
  squared_error double precision GENERATED ALWAYS AS (
    (predicted_value - actual_value) * (predicted_value - actual_value)
  ) STORED,
  interval_hit boolean GENERATED ALWAYS AS (
    CASE
      WHEN interval_low IS NULL OR interval_high IS NULL THEN NULL
      ELSE actual_value >= interval_low AND actual_value <= interval_high
    END
  ) STORED,
  horizon_days integer GENERATED ALWAYS AS (horizon_end - forecast_origin) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (horizon_end > forecast_origin),
  CHECK ((interval_low IS NULL) = (interval_high IS NULL)),
  CHECK (interval_low IS NULL OR interval_low <= interval_high),
  CHECK (NOT (training_measure_ids ? holdout_measure_id)),
  UNIQUE (
    model_version,
    metric_semantics_id,
    geography_id,
    forecast_origin,
    horizon_end,
    holdout_measure_id
  )
);

CREATE TABLE IF NOT EXISTS cbcap.forecast_backtest_summary (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  model_version text NOT NULL REFERENCES cbcap.forecast_model_registration(model_version) ON DELETE RESTRICT,
  metric_semantics_id text NOT NULL CHECK (length(btrim(metric_semantics_id)) > 0),
  case_count integer NOT NULL CHECK (case_count > 0),
  geography_count integer NOT NULL CHECK (geography_count > 0),
  mean_absolute_error double precision NOT NULL CHECK (mean_absolute_error >= 0),
  root_mean_squared_error double precision NOT NULL CHECK (root_mean_squared_error >= 0),
  mean_signed_error double precision NOT NULL,
  maximum_absolute_error double precision NOT NULL CHECK (maximum_absolute_error >= 0),
  interval_case_count integer NOT NULL CHECK (interval_case_count >= 0),
  interval_coverage double precision NULL CHECK (
    interval_coverage IS NULL OR (interval_coverage >= 0 AND interval_coverage <= 1)
  ),
  minimum_horizon_days integer NOT NULL CHECK (minimum_horizon_days > 0),
  maximum_horizon_days integer NOT NULL CHECK (maximum_horizon_days > 0),
  backtest_case_ids jsonb NOT NULL CHECK (
    jsonb_typeof(backtest_case_ids) = 'array'
    AND jsonb_array_length(backtest_case_ids) > 0
  ),
  computed_at timestamptz NOT NULL,
  review_status text NOT NULL CHECK (
    review_status IN ('verified', 'provisional', 'stale', 'unavailable', 'rejected')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (interval_case_count <= case_count),
  CHECK (
    (interval_case_count = 0 AND interval_coverage IS NULL)
    OR (interval_case_count > 0 AND interval_coverage IS NOT NULL)
  ),
  CHECK (minimum_horizon_days <= maximum_horizon_days),
  CHECK (jsonb_array_length(backtest_case_ids) = case_count)
);

CREATE TABLE IF NOT EXISTS cbcap.forecast_backtest_policy (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  model_version text NOT NULL REFERENCES cbcap.forecast_model_registration(model_version) ON DELETE RESTRICT,
  metric_semantics_id text NOT NULL CHECK (length(btrim(metric_semantics_id)) > 0),
  minimum_cases integer NOT NULL CHECK (minimum_cases > 0),
  maximum_mean_absolute_error double precision NULL CHECK (maximum_mean_absolute_error IS NULL OR maximum_mean_absolute_error >= 0),
  maximum_root_mean_squared_error double precision NULL CHECK (maximum_root_mean_squared_error IS NULL OR maximum_root_mean_squared_error >= 0),
  maximum_absolute_mean_signed_error double precision NULL CHECK (maximum_absolute_mean_signed_error IS NULL OR maximum_absolute_mean_signed_error >= 0),
  minimum_interval_coverage double precision NULL CHECK (
    minimum_interval_coverage IS NULL OR (minimum_interval_coverage >= 0 AND minimum_interval_coverage <= 1)
  ),
  intervals_required boolean NOT NULL,
  maximum_horizon_days integer NOT NULL CHECK (maximum_horizon_days > 0),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  reviewed_by text NOT NULL CHECK (length(btrim(reviewed_by)) > 0),
  reviewed_at timestamptz NOT NULL,
  review_status text NOT NULL CHECK (
    review_status IN ('verified', 'provisional', 'stale', 'unavailable', 'rejected')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cbcap.forecast_backtest_policy_evaluation (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  model_version text NOT NULL REFERENCES cbcap.forecast_model_registration(model_version) ON DELETE RESTRICT,
  metric_semantics_id text NOT NULL CHECK (length(btrim(metric_semantics_id)) > 0),
  summary_id text NOT NULL REFERENCES cbcap.forecast_backtest_summary(id) ON DELETE RESTRICT,
  policy_id text NOT NULL REFERENCES cbcap.forecast_backtest_policy(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('passes', 'blocked')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'passes' AND jsonb_array_length(reason_codes) = 0)
    OR (status = 'blocked' AND jsonb_array_length(reason_codes) > 0)
  )
);

CREATE TABLE IF NOT EXISTS cbcap.forecast_model_approval (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  model_version text NOT NULL REFERENCES cbcap.forecast_model_registration(model_version) ON DELETE RESTRICT,
  metric_semantics_id text NOT NULL CHECK (length(btrim(metric_semantics_id)) > 0),
  policy_id text NOT NULL REFERENCES cbcap.forecast_backtest_policy(id) ON DELETE RESTRICT,
  backtest_summary_id text NOT NULL REFERENCES cbcap.forecast_backtest_summary(id) ON DELETE RESTRICT,
  policy_evaluation_id text NOT NULL REFERENCES cbcap.forecast_backtest_policy_evaluation(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'suspended')),
  reason_codes jsonb NOT NULL CHECK (
    jsonb_typeof(reason_codes) = 'array'
    AND jsonb_array_length(reason_codes) > 0
  ),
  decided_by text NOT NULL CHECK (length(btrim(decided_by)) > 0),
  decided_at timestamptz NOT NULL,
  valid_from date NOT NULL,
  valid_until date NULL,
  review_status text NOT NULL CHECK (
    review_status IN ('verified', 'provisional', 'stale', 'unavailable', 'rejected')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE INDEX IF NOT EXISTS forecast_backtest_case_model_metric_idx
  ON cbcap.forecast_backtest_case (model_version, metric_semantics_id, forecast_origin, horizon_end);

CREATE INDEX IF NOT EXISTS forecast_backtest_case_geography_idx
  ON cbcap.forecast_backtest_case (geography_id, metric_semantics_id, forecast_origin DESC);

CREATE INDEX IF NOT EXISTS forecast_backtest_summary_model_metric_idx
  ON cbcap.forecast_backtest_summary (model_version, metric_semantics_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS forecast_policy_model_metric_idx
  ON cbcap.forecast_backtest_policy (model_version, metric_semantics_id, reviewed_at DESC);

CREATE INDEX IF NOT EXISTS forecast_policy_evaluation_model_metric_idx
  ON cbcap.forecast_backtest_policy_evaluation (model_version, metric_semantics_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS forecast_approval_model_metric_idx
  ON cbcap.forecast_model_approval (model_version, metric_semantics_id, decided_at DESC);

CREATE OR REPLACE FUNCTION cbcap.validate_forecast_backtest_summary_cases()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  requested_count integer;
  distinct_count integer;
  matched_count integer;
BEGIN
  SELECT count(*), count(DISTINCT value)
    INTO requested_count, distinct_count
    FROM jsonb_array_elements_text(NEW.backtest_case_ids);

  IF requested_count <> NEW.case_count OR distinct_count <> NEW.case_count THEN
    RAISE EXCEPTION
      'forecast backtest summary case IDs must be unique and equal case_count';
  END IF;

  SELECT count(*)
    INTO matched_count
    FROM cbcap.forecast_backtest_case backtest_case
   WHERE backtest_case.id IN (
     SELECT value FROM jsonb_array_elements_text(NEW.backtest_case_ids)
   )
     AND backtest_case.model_version = NEW.model_version
     AND backtest_case.metric_semantics_id = NEW.metric_semantics_id;

  IF matched_count <> NEW.case_count THEN
    RAISE EXCEPTION
      'forecast backtest summary references missing or mismatched model/metric cases';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cbcap.validate_forecast_policy_evaluation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  policy_record cbcap.forecast_backtest_policy%ROWTYPE;
  summary_record cbcap.forecast_backtest_summary%ROWTYPE;
  should_pass boolean;
BEGIN
  SELECT * INTO policy_record
    FROM cbcap.forecast_backtest_policy
   WHERE id = NEW.policy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forecast backtest policy % does not exist', NEW.policy_id;
  END IF;

  SELECT * INTO summary_record
    FROM cbcap.forecast_backtest_summary
   WHERE id = NEW.summary_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forecast backtest summary % does not exist', NEW.summary_id;
  END IF;

  IF NEW.model_version <> policy_record.model_version
    OR NEW.model_version <> summary_record.model_version
    OR NEW.metric_semantics_id <> policy_record.metric_semantics_id
    OR NEW.metric_semantics_id <> summary_record.metric_semantics_id THEN
    RAISE EXCEPTION
      'forecast policy evaluation model/metric references are inconsistent';
  END IF;

  should_pass :=
    policy_record.review_status = 'verified'
    AND summary_record.case_count >= policy_record.minimum_cases
    AND summary_record.maximum_horizon_days <= policy_record.maximum_horizon_days
    AND (
      policy_record.maximum_mean_absolute_error IS NULL
      OR summary_record.mean_absolute_error <= policy_record.maximum_mean_absolute_error
    )
    AND (
      policy_record.maximum_root_mean_squared_error IS NULL
      OR summary_record.root_mean_squared_error <= policy_record.maximum_root_mean_squared_error
    )
    AND (
      policy_record.maximum_absolute_mean_signed_error IS NULL
      OR abs(summary_record.mean_signed_error) <= policy_record.maximum_absolute_mean_signed_error
    )
    AND (
      NOT policy_record.intervals_required
      OR summary_record.interval_case_count = summary_record.case_count
    )
    AND (
      policy_record.minimum_interval_coverage IS NULL
      OR (
        summary_record.interval_coverage IS NOT NULL
        AND summary_record.interval_coverage >= policy_record.minimum_interval_coverage
      )
    );

  IF should_pass IS DISTINCT FROM (NEW.status = 'passes') THEN
    RAISE EXCEPTION
      'forecast policy evaluation status does not match stored policy and backtest summary';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cbcap.validate_forecast_model_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evaluation_record cbcap.forecast_backtest_policy_evaluation%ROWTYPE;
BEGIN
  SELECT * INTO evaluation_record
    FROM cbcap.forecast_backtest_policy_evaluation
   WHERE id = NEW.policy_evaluation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'forecast policy evaluation % does not exist',
      NEW.policy_evaluation_id;
  END IF;

  IF NEW.model_version <> evaluation_record.model_version
    OR NEW.metric_semantics_id <> evaluation_record.metric_semantics_id
    OR NEW.policy_id <> evaluation_record.policy_id
    OR NEW.backtest_summary_id <> evaluation_record.summary_id THEN
    RAISE EXCEPTION
      'forecast model approval references do not match the policy evaluation';
  END IF;

  IF NEW.decision = 'approved' AND evaluation_record.status <> 'passes' THEN
    RAISE EXCEPTION
      'forecast model cannot be approved when its stored policy evaluation is blocked';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forecast_backtest_summary_case_guard
  ON cbcap.forecast_backtest_summary;
CREATE TRIGGER forecast_backtest_summary_case_guard
BEFORE INSERT OR UPDATE OF model_version, metric_semantics_id, case_count, backtest_case_ids
ON cbcap.forecast_backtest_summary
FOR EACH ROW EXECUTE FUNCTION cbcap.validate_forecast_backtest_summary_cases();

DROP TRIGGER IF EXISTS forecast_policy_evaluation_guard
  ON cbcap.forecast_backtest_policy_evaluation;
CREATE TRIGGER forecast_policy_evaluation_guard
BEFORE INSERT OR UPDATE OF model_version, metric_semantics_id, summary_id, policy_id, status
ON cbcap.forecast_backtest_policy_evaluation
FOR EACH ROW EXECUTE FUNCTION cbcap.validate_forecast_policy_evaluation();

DROP TRIGGER IF EXISTS forecast_model_approval_guard
  ON cbcap.forecast_model_approval;
CREATE TRIGGER forecast_model_approval_guard
BEFORE INSERT OR UPDATE OF model_version, metric_semantics_id, policy_id, backtest_summary_id, policy_evaluation_id, decision
ON cbcap.forecast_model_approval
FOR EACH ROW EXECUTE FUNCTION cbcap.validate_forecast_model_approval();

DROP TRIGGER IF EXISTS forecast_model_registration_append_only
  ON cbcap.forecast_model_registration;
CREATE TRIGGER forecast_model_registration_append_only
BEFORE UPDATE OR DELETE ON cbcap.forecast_model_registration
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS forecast_backtest_case_append_only
  ON cbcap.forecast_backtest_case;
CREATE TRIGGER forecast_backtest_case_append_only
BEFORE UPDATE OR DELETE ON cbcap.forecast_backtest_case
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS forecast_backtest_summary_append_only
  ON cbcap.forecast_backtest_summary;
CREATE TRIGGER forecast_backtest_summary_append_only
BEFORE UPDATE OR DELETE ON cbcap.forecast_backtest_summary
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS forecast_backtest_policy_append_only
  ON cbcap.forecast_backtest_policy;
CREATE TRIGGER forecast_backtest_policy_append_only
BEFORE UPDATE OR DELETE ON cbcap.forecast_backtest_policy
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS forecast_policy_evaluation_append_only
  ON cbcap.forecast_backtest_policy_evaluation;
CREATE TRIGGER forecast_policy_evaluation_append_only
BEFORE UPDATE OR DELETE ON cbcap.forecast_backtest_policy_evaluation
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS forecast_model_approval_append_only
  ON cbcap.forecast_model_approval;
CREATE TRIGGER forecast_model_approval_append_only
BEFORE UPDATE OR DELETE ON cbcap.forecast_model_approval
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_immutable_record_mutation();

COMMENT ON TABLE cbcap.forecast_model_registration IS
  'Immutable registry of forecast implementation versions. Registration does not authorize execution.';

COMMENT ON TABLE cbcap.forecast_backtest_case IS
  'Immutable holdout forecast cases used for transparent planning-model backtesting. Holdout observations cannot be part of training inputs.';

COMMENT ON TABLE cbcap.forecast_backtest_policy_evaluation IS
  'Deterministic evaluation of one stored backtest summary against one reviewed metric-specific policy. It is not a human approval.';

COMMENT ON TABLE cbcap.forecast_model_approval IS
  'Human model-governance decision referencing the exact stored policy evaluation and backtest summary.';

COMMIT;
