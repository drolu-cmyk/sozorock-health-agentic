BEGIN;

DO $$
BEGIN
  IF to_regclass('cbcap.trajectory_event') IS NOT NULL
    OR to_regclass('cbcap.trajectory_evaluation_label') IS NOT NULL
    OR to_regclass('cbcap.trajectory_correction') IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to roll back decision memory while trajectory migration 002 is still present. Roll back 002 first.';
  END IF;

  IF EXISTS (SELECT 1 FROM cbcap.decision_memory LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing to drop cbcap.decision_memory because institutional memory records exist. Export or migrate them explicitly before rollback.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS decision_memory_append_only ON cbcap.decision_memory;
DROP TABLE IF EXISTS cbcap.decision_memory;
DROP FUNCTION IF EXISTS cbcap.prevent_immutable_record_mutation();

COMMIT;
