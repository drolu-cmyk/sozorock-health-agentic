BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cbcap.publication_authorization LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing to drop CB-CAP publication authorization history because approval records exist. Export or migrate them explicitly before rollback.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS publication_authorization_memory_guard
  ON cbcap.publication_authorization;
DROP TRIGGER IF EXISTS publication_authorization_append_only
  ON cbcap.publication_authorization;
DROP POLICY IF EXISTS publication_authorization_tenant_isolation
  ON cbcap.publication_authorization;
DROP TABLE IF EXISTS cbcap.publication_authorization;
DROP FUNCTION IF EXISTS cbcap.validate_publication_authorization_memory();

COMMIT;
