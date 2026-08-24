BEGIN;

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id uuid PRIMARY KEY,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  product text NOT NULL CHECK (length(btrim(product)) > 0),
  task_type text NOT NULL CHECK (length(btrim(task_type)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (run_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS agent_runs_tenant_updated_idx
  ON agent_runs (tenant_id, updated_at DESC, run_id);

CREATE TABLE IF NOT EXISTS agent_run_events (
  run_id uuid NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (length(btrim(event_type)) > 0),
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, sequence),
  CONSTRAINT agent_run_events_run_tenant_fk
    FOREIGN KEY (run_id, tenant_id)
    REFERENCES agent_runs (run_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS agent_run_events_tenant_type_idx
  ON agent_run_events (tenant_id, event_type, created_at DESC, run_id, sequence);

CREATE OR REPLACE FUNCTION deny_agent_run_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'agent_run_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS agent_run_events_append_only ON agent_run_events;
CREATE TRIGGER agent_run_events_append_only
BEFORE UPDATE OR DELETE ON agent_run_events
FOR EACH ROW
EXECUTE FUNCTION deny_agent_run_event_mutation();

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_runs_tenant_scope ON agent_runs;
CREATE POLICY agent_runs_tenant_scope ON agent_runs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS agent_run_events_tenant_scope ON agent_run_events;
CREATE POLICY agent_run_events_tenant_scope ON agent_run_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

COMMENT ON TABLE agent_runs IS
  'Tenant-scoped CB-CAP and agent workflow run registry. Application connections must set app.tenant_id before access.';

COMMENT ON TABLE agent_run_events IS
  'Append-only workflow event and checkpoint log. Updates and deletes are rejected by trigger.';

COMMIT;
