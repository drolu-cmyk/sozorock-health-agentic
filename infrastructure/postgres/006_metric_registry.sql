BEGIN;
CREATE TABLE IF NOT EXISTS cbcap_metric_registry (
  tenant_id text NOT NULL,
  id uuid NOT NULL,
  county_fips text NOT NULL CHECK (county_fips ~ '^[0-9]{5}$'),
  definition jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  review_status text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','reviewed','retired')),
  created_by text NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  CHECK (review_status <> 'reviewed' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS cbcap_metric_events (
  tenant_id text NOT NULL,
  metric_id uuid NOT NULL,
  version integer NOT NULL,
  action text NOT NULL,
  actor_id text NOT NULL,
  definition jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,metric_id) REFERENCES cbcap_metric_registry(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS cbcap_metric_county_idx ON cbcap_metric_registry(tenant_id,county_fips);
ALTER TABLE cbcap_metric_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_metric_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap_metric_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_metric_events FORCE ROW LEVEL SECURITY;
CREATE POLICY cbcap_metric_registry_tenant_scope ON cbcap_metric_registry
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
CREATE POLICY cbcap_metric_events_tenant_scope ON cbcap_metric_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
CREATE TRIGGER cbcap_metric_events_append_only
  BEFORE UPDATE OR DELETE ON cbcap_metric_events
  FOR EACH ROW EXECUTE FUNCTION deny_cbcap_workspace_event_mutation();
COMMIT;
