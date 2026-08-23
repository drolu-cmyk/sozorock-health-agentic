BEGIN;

DROP TRIGGER IF EXISTS publication_authorization_append_only
  ON cbcap.publication_authorization;
DROP POLICY IF EXISTS publication_authorization_tenant_isolation
  ON cbcap.publication_authorization;
DROP TABLE IF EXISTS cbcap.publication_authorization;

COMMIT;
