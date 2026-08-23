BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cbcap.trajectory_correction LIMIT 1)
    OR EXISTS (SELECT 1 FROM cbcap.trajectory_evaluation_label LIMIT 1)
    OR EXISTS (SELECT 1 FROM cbcap.trajectory_event LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing to drop CB-CAP trajectory history because execution, evaluation, or correction records exist. Export or migrate them explicitly before rollback.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trajectory_correction_parent_tenant_guard
  ON cbcap.trajectory_correction;
DROP TRIGGER IF EXISTS trajectory_label_parent_tenant_guard
  ON cbcap.trajectory_evaluation_label;
DROP TRIGGER IF EXISTS trajectory_correction_append_only
  ON cbcap.trajectory_correction;
DROP TRIGGER IF EXISTS trajectory_label_append_only
  ON cbcap.trajectory_evaluation_label;
DROP TRIGGER IF EXISTS trajectory_event_append_only
  ON cbcap.trajectory_event;

DROP TABLE IF EXISTS cbcap.trajectory_correction;
DROP TABLE IF EXISTS cbcap.trajectory_evaluation_label;
DROP TABLE IF EXISTS cbcap.trajectory_event;

DROP FUNCTION IF EXISTS cbcap.enforce_trajectory_child_tenant();

COMMIT;
