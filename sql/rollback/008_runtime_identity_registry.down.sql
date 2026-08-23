BEGIN;

DO $$
BEGIN
  IF to_regclass('cbcap.workspace_membership_event') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cbcap.workspace_membership_event LIMIT 1) THEN
    RAISE EXCEPTION 'Refusing to drop CB-CAP workspace membership history while records exist';
  END IF;

  IF to_regclass('cbcap.county_run_state_version') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cbcap.county_run_state_version LIMIT 1) THEN
    RAISE EXCEPTION 'Refusing to drop CB-CAP county run state history while records exist';
  END IF;

  IF to_regclass('cbcap.county_run_identity') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cbcap.county_run_identity LIMIT 1) THEN
    RAISE EXCEPTION 'Refusing to drop CB-CAP county run identities while records exist';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS county_run_state_append_only ON cbcap.county_run_state_version;
DROP TRIGGER IF EXISTS county_run_state_guard ON cbcap.county_run_state_version;
DROP TRIGGER IF EXISTS county_run_identity_append_only ON cbcap.county_run_identity;
DROP TRIGGER IF EXISTS workspace_membership_append_only ON cbcap.workspace_membership_event;

DROP POLICY IF EXISTS county_run_state_tenant_isolation ON cbcap.county_run_state_version;
DROP POLICY IF EXISTS county_run_identity_tenant_isolation ON cbcap.county_run_identity;
DROP POLICY IF EXISTS workspace_membership_tenant_isolation ON cbcap.workspace_membership_event;

DROP TABLE IF EXISTS cbcap.county_run_state_version;
DROP TABLE IF EXISTS cbcap.county_run_identity;
DROP TABLE IF EXISTS cbcap.workspace_membership_event;

DROP FUNCTION IF EXISTS cbcap.validate_county_run_state_version();
DROP FUNCTION IF EXISTS cbcap.prevent_runtime_registry_mutation();

COMMIT;
