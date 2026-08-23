BEGIN;

CREATE TABLE IF NOT EXISTS cbcap.workspace_membership_event (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  principal_key text NOT NULL CHECK (principal_key ~ '^principal:sha256:[0-9a-f]{64}$'),
  decision text NOT NULL CHECK (decision IN ('granted', 'revoked')),
  role text NOT NULL CHECK (role IN ('read_only', 'analyst', 'planner', 'reviewer', 'admin')),
  geography_ids jsonb NOT NULL CHECK (jsonb_typeof(geography_ids) = 'array'),
  membership_version text NOT NULL CHECK (length(btrim(membership_version)) > 0),
  recorded_by text NOT NULL CHECK (length(btrim(recorded_by)) > 0),
  recorded_at timestamptz NOT NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, principal_key, membership_version),
  UNIQUE (tenant_id, principal_key, recorded_at),
  CHECK (expires_at IS NULL OR expires_at > recorded_at),
  CHECK (decision = 'revoked' OR jsonb_array_length(geography_ids) > 0)
);

CREATE INDEX IF NOT EXISTS workspace_membership_lookup_idx
  ON cbcap.workspace_membership_event (tenant_id, principal_key, recorded_at DESC);

CREATE TABLE IF NOT EXISTS cbcap.county_run_identity (
  run_id text PRIMARY KEY CHECK (length(btrim(run_id)) > 0),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  geography_id text NOT NULL CHECK (length(btrim(geography_id)) > 0),
  county_fips text NOT NULL CHECK (county_fips ~ '^[0-9]{5}$'),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, run_id)
);

CREATE TABLE IF NOT EXISTS cbcap.county_run_state_version (
  id text PRIMARY KEY CHECK (id ~ '^county-run-state:sha256:[0-9a-f]{64}$'),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  run_id text NOT NULL REFERENCES cbcap.county_run_identity(run_id) ON DELETE RESTRICT,
  version_no bigint NOT NULL CHECK (version_no > 0),
  state_hash text NOT NULL CHECK (state_hash ~ '^sha256:[0-9a-f]{64}$'),
  state_json jsonb NOT NULL CHECK (jsonb_typeof(state_json) = 'object'),
  status text NOT NULL CHECK (
    status IN ('created', 'running', 'waiting_review', 'blocked', 'completed', 'cancelled', 'failed')
  ),
  recorded_by text NOT NULL CHECK (length(btrim(recorded_by)) > 0),
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, version_no),
  UNIQUE (tenant_id, run_id, state_hash)
);

CREATE INDEX IF NOT EXISTS county_run_state_latest_idx
  ON cbcap.county_run_state_version (tenant_id, run_id, version_no DESC);

ALTER TABLE cbcap.workspace_membership_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.workspace_membership_event FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap.county_run_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.county_run_identity FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap.county_run_state_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.county_run_state_version FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_membership_tenant_isolation ON cbcap.workspace_membership_event;
CREATE POLICY workspace_membership_tenant_isolation
  ON cbcap.workspace_membership_event
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS county_run_identity_tenant_isolation ON cbcap.county_run_identity;
CREATE POLICY county_run_identity_tenant_isolation
  ON cbcap.county_run_identity
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS county_run_state_tenant_isolation ON cbcap.county_run_state_version;
CREATE POLICY county_run_state_tenant_isolation
  ON cbcap.county_run_state_version
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE OR REPLACE FUNCTION cbcap.prevent_runtime_registry_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '%.% is append-only runtime history; record a new event or state version instead',
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION cbcap.validate_workspace_membership_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  geography_count bigint;
  distinct_geography_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(NEW.geography_ids) AS item
     WHERE jsonb_typeof(item) <> 'string'
        OR length(btrim(item #>> '{}')) = 0
  ) THEN
    RAISE EXCEPTION 'workspace membership geography IDs must be nonblank strings';
  END IF;

  SELECT count(*), count(DISTINCT geography_id)
    INTO geography_count, distinct_geography_count
    FROM jsonb_array_elements_text(NEW.geography_ids) AS geography_id;

  IF geography_count <> distinct_geography_count THEN
    RAISE EXCEPTION 'workspace membership geography IDs must be unique';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cbcap.validate_county_run_state_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  identity_record cbcap.county_run_identity%ROWTYPE;
  prior_version bigint;
BEGIN
  SELECT * INTO identity_record
    FROM cbcap.county_run_identity
   WHERE run_id = NEW.run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'county run identity % is missing in the active tenant scope', NEW.run_id;
  END IF;

  IF identity_record.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'county run state tenant does not match run identity tenant';
  END IF;

  IF NEW.state_json->>'schema_version' IS DISTINCT FROM 'cbcap.county-run.v1' THEN
    RAISE EXCEPTION 'county run state schema version is invalid';
  END IF;

  IF NEW.state_json->>'tenant_id' IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'county run state JSON tenant does not match row tenant';
  END IF;

  IF NEW.state_json->>'run_id' IS DISTINCT FROM NEW.run_id THEN
    RAISE EXCEPTION 'county run state JSON run does not match row run';
  END IF;

  IF NEW.state_json #>> '{county,id}' IS DISTINCT FROM identity_record.geography_id THEN
    RAISE EXCEPTION 'county run state JSON geography does not match immutable run identity';
  END IF;

  IF NEW.state_json #>> '{county,county_fips}' IS DISTINCT FROM identity_record.county_fips THEN
    RAISE EXCEPTION 'county run state JSON county FIPS does not match immutable run identity';
  END IF;

  IF NEW.state_json->>'status' IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'county run state JSON status does not match row status';
  END IF;

  SELECT max(version_no) INTO prior_version
    FROM cbcap.county_run_state_version
   WHERE tenant_id = NEW.tenant_id
     AND run_id = NEW.run_id;

  IF prior_version IS NULL THEN
    IF NEW.version_no <> 1 THEN
      RAISE EXCEPTION 'first county run state version must be 1';
    END IF;
  ELSIF NEW.version_no <> prior_version + 1 THEN
    RAISE EXCEPTION 'county run state versions must be contiguous';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_membership_guard ON cbcap.workspace_membership_event;
CREATE TRIGGER workspace_membership_guard
BEFORE INSERT ON cbcap.workspace_membership_event
FOR EACH ROW EXECUTE FUNCTION cbcap.validate_workspace_membership_event();

DROP TRIGGER IF EXISTS workspace_membership_append_only ON cbcap.workspace_membership_event;
CREATE TRIGGER workspace_membership_append_only
BEFORE UPDATE OR DELETE ON cbcap.workspace_membership_event
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_runtime_registry_mutation();

DROP TRIGGER IF EXISTS county_run_identity_append_only ON cbcap.county_run_identity;
CREATE TRIGGER county_run_identity_append_only
BEFORE UPDATE OR DELETE ON cbcap.county_run_identity
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_runtime_registry_mutation();

DROP TRIGGER IF EXISTS county_run_state_guard ON cbcap.county_run_state_version;
CREATE TRIGGER county_run_state_guard
BEFORE INSERT ON cbcap.county_run_state_version
FOR EACH ROW EXECUTE FUNCTION cbcap.validate_county_run_state_version();

DROP TRIGGER IF EXISTS county_run_state_append_only ON cbcap.county_run_state_version;
CREATE TRIGGER county_run_state_append_only
BEFORE UPDATE OR DELETE ON cbcap.county_run_state_version
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_runtime_registry_mutation();

COMMENT ON TABLE cbcap.workspace_membership_event IS
  'Append-only server-side workspace membership history keyed by an opaque verified principal identity. Browser token roles are never authoritative.';

COMMENT ON TABLE cbcap.county_run_identity IS
  'Immutable tenant and county identity for one CB-CAP run. Runtime APIs load this identity rather than accepting canonical run scope from a request body.';

COMMENT ON TABLE cbcap.county_run_state_version IS
  'Append-only canonical county run state versions. The latest contiguous version is the server-owned runtime state used for execution and review.';

COMMIT;
