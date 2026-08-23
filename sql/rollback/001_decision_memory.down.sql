BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cbcap.decision_memory LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing to drop cbcap.decision_memory because institutional memory records exist. Export or migrate them explicitly before rollback.';
  END IF;
END $$;

DROP TABLE IF EXISTS cbcap.decision_memory;

COMMIT;
