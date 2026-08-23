BEGIN;

CREATE SCHEMA IF NOT EXISTS cbcap;

CREATE TABLE IF NOT EXISTS cbcap.trajectory_event (
  id text PRIMARY KEY,
  run_id text NOT NULL CHECK (length(btrim(run_id)) > 0),
  tenant_id text NULL,
  geography_id text NOT NULL CHECK (length(btrim(geography_id)) > 0),
  stage text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('deterministic', 'agent', 'reviewer', 'system')),
  actor_name text NOT NULL CHECK (length(btrim(actor_name)) > 0),
  actor_version text NOT NULL CHECK (length(btrim(actor_version)) > 0),
  entity_id text NOT NULL CHECK (length(btrim(entity_id)) > 0),
  outcome text NOT NULL CHECK (length(btrim(outcome)) > 0),
  outcome_class text NOT NULL CHECK (outcome_class IN (
    'accepted', 'rejected', 'blocked', 'review_required', 'completed', 'unknown', 'error'
  )),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  source_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_entity_ids) = 'array'),
  tool_names jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tool_names) = 'array'),
  input_state_hash text NULL,
  output_state_hash text NULL,
  model_provider text NULL,
  model_name text NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (input_tokens = 0 AND output_tokens = 0 AND estimated_cost_usd = 0)
    OR model_provider IS NOT NULL
    OR model_name IS NOT NULL
  ),
  CHECK (
    actor_type <> 'deterministic'
    OR (input_tokens = 0 AND output_tokens = 0 AND estimated_cost_usd = 0)
  )
);

CREATE TABLE IF NOT EXISTS cbcap.trajectory_evaluation_label (
  id text PRIMARY KEY,
  trajectory_event_id text NOT NULL REFERENCES cbcap.trajectory_event(id) ON DELETE RESTRICT,
  tenant_id text NULL,
  label text NOT NULL CHECK (label IN (
    'correct', 'incorrect', 'incomplete', 'unsafe', 'source_error', 'scope_error', 'needs_human_judgment'
  )),
  reason_codes jsonb NOT NULL CHECK (
    jsonb_typeof(reason_codes) = 'array'
    AND jsonb_array_length(reason_codes) > 0
  ),
  evaluator_id text NOT NULL CHECK (length(btrim(evaluator_id)) > 0),
  evaluator_type text NOT NULL CHECK (evaluator_type IN ('human', 'deterministic_eval', 'model_eval')),
  evaluator_version text NOT NULL CHECK (length(btrim(evaluator_version)) > 0),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cbcap.trajectory_correction (
  id text PRIMARY KEY,
  trajectory_event_id text NOT NULL REFERENCES cbcap.trajectory_event(id) ON DELETE RESTRICT,
  tenant_id text NULL,
  corrected_entity_id text NOT NULL CHECK (length(btrim(corrected_entity_id)) > 0),
  correction_type text NOT NULL CHECK (correction_type IN (
    'source_selection', 'geography_scope', 'extraction', 'classification', 'eligibility',
    'forecast_assumption', 'review_decision', 'other'
  )),
  reason_codes jsonb NOT NULL CHECK (
    jsonb_typeof(reason_codes) = 'array'
    AND jsonb_array_length(reason_codes) > 0
  ),
  corrected_by text NOT NULL CHECK (length(btrim(corrected_by)) > 0),
  corrected_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS trajectory_event_run_time_idx
  ON cbcap.trajectory_event (run_id, occurred_at);

CREATE INDEX IF NOT EXISTS trajectory_event_tenant_geography_stage_idx
  ON cbcap.trajectory_event (tenant_id, geography_id, stage, occurred_at DESC);

CREATE INDEX IF NOT EXISTS trajectory_event_outcome_idx
  ON cbcap.trajectory_event (stage, outcome_class, occurred_at DESC);

CREATE INDEX IF NOT EXISTS trajectory_label_event_idx
  ON cbcap.trajectory_evaluation_label (trajectory_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS trajectory_correction_event_idx
  ON cbcap.trajectory_correction (trajectory_event_id, corrected_at DESC);

ALTER TABLE cbcap.trajectory_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.trajectory_event FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap.trajectory_evaluation_label ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.trajectory_evaluation_label FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap.trajectory_correction ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.trajectory_correction FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trajectory_event_tenant_isolation ON cbcap.trajectory_event;
CREATE POLICY trajectory_event_tenant_isolation
  ON cbcap.trajectory_event
  USING (
    tenant_id IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')
  );

DROP POLICY IF EXISTS trajectory_label_tenant_isolation ON cbcap.trajectory_evaluation_label;
CREATE POLICY trajectory_label_tenant_isolation
  ON cbcap.trajectory_evaluation_label
  USING (
    tenant_id IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')
  );

DROP POLICY IF EXISTS trajectory_correction_tenant_isolation ON cbcap.trajectory_correction;
CREATE POLICY trajectory_correction_tenant_isolation
  ON cbcap.trajectory_correction
  USING (
    tenant_id IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')
  );

COMMENT ON TABLE cbcap.trajectory_event IS
  'Append-only structured CB-CAP execution trajectory. Raw external page text and chat transcripts do not belong here.';

COMMENT ON TABLE cbcap.trajectory_evaluation_label IS
  'Append-only evaluator labels used to measure trajectory quality without mutating the original execution record.';

COMMENT ON TABLE cbcap.trajectory_correction IS
  'Append-only human corrections that can form governed golden evaluation data after review.';

COMMIT;
