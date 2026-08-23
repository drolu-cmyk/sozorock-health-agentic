BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cbcap.tenant_evidence_review LIMIT 1)
    OR EXISTS (SELECT 1 FROM cbcap.tenant_evidence_document LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing to drop CB-CAP tenant-private evidence history because document or review records exist. Export or migrate them explicitly before rollback.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS tenant_evidence_review_guard ON cbcap.tenant_evidence_review;
DROP TRIGGER IF EXISTS tenant_evidence_review_append_only ON cbcap.tenant_evidence_review;
DROP TRIGGER IF EXISTS tenant_evidence_document_append_only ON cbcap.tenant_evidence_document;
DROP POLICY IF EXISTS tenant_evidence_review_tenant_isolation ON cbcap.tenant_evidence_review;
DROP POLICY IF EXISTS tenant_evidence_document_tenant_isolation ON cbcap.tenant_evidence_document;
DROP TABLE IF EXISTS cbcap.tenant_evidence_review;
DROP TABLE IF EXISTS cbcap.tenant_evidence_document;
DROP FUNCTION IF EXISTS cbcap.validate_tenant_evidence_review();
DROP FUNCTION IF EXISTS cbcap.prevent_tenant_evidence_mutation();

COMMIT;
