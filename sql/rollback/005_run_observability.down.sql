BEGIN;

DROP TRIGGER IF EXISTS run_observation_append_only ON cbcap.run_observation;
DROP POLICY IF EXISTS run_observation_tenant_isolation ON cbcap.run_observation;
DROP TABLE IF EXISTS cbcap.run_observation;

COMMIT;
