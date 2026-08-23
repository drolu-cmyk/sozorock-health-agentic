BEGIN;

CREATE TABLE IF NOT EXISTS cbcap.run_observation (
  id text PRIMARY KEY,
  run_id text NOT NULL CHECK (length(btrim(run_id)) > 0),
  tenant_id text NULL,
  geography_id text NOT NULL CHECK (length(btrim(geography_id)) > 0),
  phase text NOT NULL CHECK (phase IN ('initial', 'review_resume')),
  status text NOT NULL CHECK (status IN (
    'created', 'running', 'waiting_review', 'blocked', 'completed', 'cancelled', 'failed'
  )),
  evidence_release_id text NULL,
  evidence_release_hash text NULL CHECK (
    evidence_release_hash IS NULL OR evidence_release_hash ~ '^sha256:[0-9a-fA-F]{64}$'
  ),
  requested_at timestamptz NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  queue_wait_ms bigint NULL CHECK (queue_wait_ms IS NULL OR queue_wait_ms >= 0),
  request_clock_skew_detected boolean NOT NULL DEFAULT false,
  evidence_fetch_ms bigint NULL CHECK (evidence_fetch_ms IS NULL OR evidence_fetch_ms >= 0),
  graph_duration_ms bigint NOT NULL CHECK (graph_duration_ms >= 0),
  total_duration_ms bigint NOT NULL CHECK (total_duration_ms >= 0),
  external_calls_used integer NOT NULL CHECK (external_calls_used >= 0),
  model_tokens_used integer NOT NULL CHECK (model_tokens_used >= 0),
  model_cost_usd numeric(16,8) NOT NULL CHECK (model_cost_usd >= 0),
  interrupted boolean NOT NULL,
  review_count integer NOT NULL CHECK (review_count >= 0),
  review_intervention boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at >= started_at),
  CHECK ((phase = 'initial') OR evidence_fetch_ms IS NULL),
  CHECK ((phase = 'initial') OR evidence_release_hash IS NULL),
  CHECK ((phase = 'initial') OR evidence_release_id IS NULL)
);

CREATE INDEX IF NOT EXISTS run_observation_tenant_run_time_idx
  ON cbcap.run_observation (tenant_id, run_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS run_observation_geography_time_idx
  ON cbcap.run_observation (geography_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS run_observation_status_time_idx
  ON cbcap.run_observation (status, completed_at DESC);

ALTER TABLE cbcap.run_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.run_observation FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS run_observation_tenant_isolation ON cbcap.run_observation;
CREATE POLICY run_observation_tenant_isolation
  ON cbcap.run_observation
  USING (
    coalesce(tenant_id, '') = coalesce(nullif(current_setting('app.tenant_id', true), ''), '')
  )
  WITH CHECK (
    coalesce(tenant_id, '') = coalesce(nullif(current_setting('app.tenant_id', true), ''), '')
  );

DROP TRIGGER IF EXISTS run_observation_append_only ON cbcap.run_observation;
CREATE TRIGGER run_observation_append_only
BEFORE UPDATE OR DELETE ON cbcap.run_observation
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_immutable_record_mutation();

COMMENT ON TABLE cbcap.run_observation IS
  'Append-only CB-CAP operational observations. Stores timing, budgets, release identity, status and review intervention only; no source prose or tenant document content.';

COMMENT ON COLUMN cbcap.run_observation.evidence_fetch_ms IS
  'Wall-clock latency for the single validated public Evidence Gateway fetch during the initial execution phase.';

COMMIT;
