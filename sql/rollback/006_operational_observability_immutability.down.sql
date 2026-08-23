BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cbcap.run_telemetry LIMIT 1)
    OR EXISTS (SELECT 1 FROM cbcap.node_telemetry_sample LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing to remove CB-CAP observability immutability while operational telemetry records exist. Export or migrate them explicitly before rollback.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS node_telemetry_sample_append_only ON cbcap.node_telemetry_sample;
DROP TRIGGER IF EXISTS run_telemetry_append_only ON cbcap.run_telemetry;
DROP FUNCTION IF EXISTS cbcap.prevent_observability_mutation();

COMMIT;
