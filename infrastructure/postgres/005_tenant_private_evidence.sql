BEGIN;

CREATE TABLE IF NOT EXISTS cbcap_tenant_evidence_documents (
  id text NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  geography_ids jsonb NOT NULL CHECK (jsonb_typeof(geography_ids) = 'array' AND jsonb_array_length(geography_ids) > 0),
  submitted_in_run_id text NOT NULL CHECK (length(btrim(submitted_in_run_id)) > 0),
  upload_id text NOT NULL CHECK (length(btrim(upload_id)) > 0),
  storage_bucket text NOT NULL CHECK (storage_bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'),
  storage_key text NOT NULL CHECK (length(btrim(storage_key)) > 0),
  storage_version_id text NOT NULL CHECK (length(btrim(storage_version_id)) > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  media_type text NOT NULL CHECK (length(btrim(media_type)) > 0),
  encryption_mode text NOT NULL CHECK (encryption_mode = 'aws:kms'),
  kms_key_arn text NOT NULL CHECK (kms_key_arn ~ '^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[A-Za-z0-9-]+$'),
  public_access_blocked boolean NOT NULL CHECK (public_access_blocked),
  security_scan_status text NOT NULL CHECK (security_scan_status IN ('clean','blocked','pending')),
  document_type text NOT NULL CHECK (length(btrim(document_type)) > 0),
  source_label text NOT NULL CHECK (length(btrim(source_label)) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('internal','confidential','restricted')),
  rights_basis text NOT NULL CHECK (rights_basis IN ('organization_owned','partner_authorized','licensed_for_use')),
  usage_rights_confirmed boolean NOT NULL,
  aggregation_level text NOT NULL CHECK (aggregation_level IN ('organizational','community_aggregate','program_aggregate','person_level')),
  contains_phi boolean NOT NULL DEFAULT false,
  contains_individual_health_records boolean NOT NULL DEFAULT false,
  contains_credentials_or_secrets boolean NOT NULL DEFAULT false,
  admission_state text NOT NULL CHECK (admission_state IN ('eligible_for_review','quarantined','rejected')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  submitted_by text NOT NULL CHECK (length(btrim(submitted_by)) > 0),
  submitted_at timestamptz NOT NULL,
  retention_until date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, upload_id, storage_version_id),
  UNIQUE (tenant_id, content_hash, submitted_in_run_id),
  CHECK (storage_key !~ '(^|/)\.\.?(/|$)'),
  CHECK (
    admission_state <> 'eligible_for_review'
    OR (
      usage_rights_confirmed
      AND aggregation_level <> 'person_level'
      AND NOT contains_phi
      AND NOT contains_individual_health_records
      AND NOT contains_credentials_or_secrets
      AND security_scan_status = 'clean'
    )
  )
);

CREATE TABLE IF NOT EXISTS cbcap_tenant_evidence_reviews (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  document_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepted','rejected','needs_revision')),
  reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array' AND jsonb_array_length(reason_codes) > 0),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  reviewed_by text NOT NULL CHECK (length(btrim(reviewed_by)) > 0),
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cbcap_tenant_evidence_review_document_fk
    FOREIGN KEY (tenant_id, document_id)
    REFERENCES cbcap_tenant_evidence_documents (tenant_id, id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, document_id, reviewed_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS cbcap_tenant_evidence_one_acceptance_idx
  ON cbcap_tenant_evidence_reviews (tenant_id, document_id)
  WHERE decision = 'accepted';

CREATE INDEX IF NOT EXISTS cbcap_tenant_evidence_documents_run_idx
  ON cbcap_tenant_evidence_documents (tenant_id, submitted_in_run_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS cbcap_tenant_evidence_documents_geographies_gin
  ON cbcap_tenant_evidence_documents USING gin (geography_ids);
CREATE INDEX IF NOT EXISTS cbcap_tenant_evidence_reviews_document_idx
  ON cbcap_tenant_evidence_reviews (tenant_id, document_id, reviewed_at DESC);

ALTER TABLE cbcap_tenant_evidence_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_tenant_evidence_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap_tenant_evidence_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_tenant_evidence_reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cbcap_tenant_evidence_documents_tenant_isolation ON cbcap_tenant_evidence_documents;
CREATE POLICY cbcap_tenant_evidence_documents_tenant_isolation
  ON cbcap_tenant_evidence_documents
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS cbcap_tenant_evidence_reviews_tenant_isolation ON cbcap_tenant_evidence_reviews;
CREATE POLICY cbcap_tenant_evidence_reviews_tenant_isolation
  ON cbcap_tenant_evidence_reviews
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE OR REPLACE FUNCTION cbcap_validate_tenant_evidence_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document_record cbcap_tenant_evidence_documents%ROWTYPE;
BEGIN
  SELECT * INTO document_record
    FROM cbcap_tenant_evidence_documents
   WHERE tenant_id = NEW.tenant_id AND id = NEW.document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant evidence document is missing or outside the active tenant scope';
  END IF;

  IF NEW.decision = 'accepted' AND document_record.admission_state <> 'eligible_for_review' THEN
    RAISE EXCEPTION 'only eligible tenant evidence can be accepted';
  END IF;

  IF NEW.decision = 'accepted'
     AND document_record.retention_until IS NOT NULL
     AND document_record.retention_until < NEW.reviewed_at::date THEN
    RAISE EXCEPTION 'expired tenant evidence cannot be accepted';
  END IF;

  IF NEW.decision = 'needs_revision' AND document_record.admission_state = 'rejected' THEN
    RAISE EXCEPTION 'rejected tenant evidence cannot be changed to needs_revision';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cbcap_prevent_tenant_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tenant-private evidence history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS cbcap_tenant_evidence_review_guard ON cbcap_tenant_evidence_reviews;
CREATE TRIGGER cbcap_tenant_evidence_review_guard
BEFORE INSERT ON cbcap_tenant_evidence_reviews
FOR EACH ROW EXECUTE FUNCTION cbcap_validate_tenant_evidence_review();

DROP TRIGGER IF EXISTS cbcap_tenant_evidence_documents_append_only ON cbcap_tenant_evidence_documents;
CREATE TRIGGER cbcap_tenant_evidence_documents_append_only
BEFORE UPDATE OR DELETE ON cbcap_tenant_evidence_documents
FOR EACH ROW EXECUTE FUNCTION cbcap_prevent_tenant_evidence_mutation();

DROP TRIGGER IF EXISTS cbcap_tenant_evidence_reviews_append_only ON cbcap_tenant_evidence_reviews;
CREATE TRIGGER cbcap_tenant_evidence_reviews_append_only
BEFORE UPDATE OR DELETE ON cbcap_tenant_evidence_reviews
FOR EACH ROW EXECUTE FUNCTION cbcap_prevent_tenant_evidence_mutation();

COMMENT ON TABLE cbcap_tenant_evidence_documents IS
  'Tenant-private immutable metadata for versioned KMS-encrypted objects. Raw object content and storage location are never part of the public Evidence Gateway.';
COMMENT ON TABLE cbcap_tenant_evidence_reviews IS
  'Append-only human review decisions for tenant-private evidence. Acceptance authorizes tenant-only use; it does not publish evidence or promote institutional truth.';

COMMIT;
