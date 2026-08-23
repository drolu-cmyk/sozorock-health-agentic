BEGIN;

CREATE OR REPLACE FUNCTION cbcap.prevent_observability_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '%.% is append-only operational history; create a new telemetry record instead of mutating history',
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS run_telemetry_append_only ON cbcap.run_telemetry;
CREATE TRIGGER run_telemetry_append_only
BEFORE UPDATE OR DELETE ON cbcap.run_telemetry
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_observability_mutation();

DROP TRIGGER IF EXISTS node_telemetry_sample_append_only ON cbcap.node_telemetry_sample;
CREATE TRIGGER node_telemetry_sample_append_only
BEFORE UPDATE OR DELETE ON cbcap.node_telemetry_sample
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_observability_mutation();

COMMENT ON FUNCTION cbcap.prevent_observability_mutation() IS
  'Independent immutability guard for operational telemetry. Kept separate from decision-memory migration order.';

COMMIT;
