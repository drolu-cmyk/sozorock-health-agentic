BEGIN;

CREATE TABLE IF NOT EXISTS cbcap.tenant_evidence_document (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  geography_ids jsonb NOT NULL CHECK (
    jsonb_typeof(geography_ids) = 'array'
    AND jsonb_array_length(geography_ids) > 0
  ),
  submitted_in_run_id text NOT NULL CHECK (length(btrim(submitted_in_run_id)) > 0),
  storage_bucket text NOT NULL CHECK (storage_bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'),
  storage_key text NOT NULL CHECK (length(btrim(storage_key)) > 0),
  storage_version_id text NOT NULL CHECK (length(btrim(storage_version_id)) > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-fA-F]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  media_type text NOT NULL CHECK (length(btrim(media_type)) > 0),
  encryption_mode text NOT NULL CHECK (encryption_mode = 'aws:kms'),
  kms_key_arn text NOT NULL CHECK (
    kms_key_arn ~ '^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[A-Za-z0-9-]+$'
  ),
  public_access_blocked boolean NOT NULL CHECK (public_access_blocked),
  document_type text NOT NULL CHECK (length(btrim(document_type)) > 0),
  source_label text NOT NULL CHECK (length(btrim(source_label)) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('internal', 'confidential', 'restricted')),
  rights_basis text NOT NULL CHECK (
    rights_basis IN ('organization_owned', 'partner_authorized', 'licensed_for_use')
  ),
  usage_rights_confirmed boolean NOT NULL,
  aggregation_level text NOT NULL CHECK (
    aggregation_level IN ('organizational', 'community_aggregate', 'program_aggregate', 'person_level')
  ),
  contains_phi boolean NOT NULL DEFAULT false,
  contains_individual_health_records boolean NOT NULL DEFAULT false,
  contains_credentials_or_secrets boolean NOT NULL DEFAULT false,
  admission_state text NOT NULL CHECK (
    admission_state IN ('eligible_for_review', 'quarantined', 'rejected')
  ),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  submitted_by text NOT NULL CHECK (length(btrim(submitted_by)) > 0),
  submitted_at timestamptz NOT NULL,
  retention_until date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
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
    )
  )
);

CREATE TABLE IF NOT EXISTS cbcap.tenant_evidence_review (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  document_id text NOT NULL REFERENCES cbcap.tenant_evidence_document(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  decision text NOT NULL CHECK (decision IN ('accepted', 'rejected', 'needs_revision')),
  reason_codes jsonb NOT NULL CHECK (
    jsonb_typeof(reason_codes) = 'array'
    AND jsonb_array_length(reason_codes) > 0
  ),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  reviewed_by text NOT NULL CHECK (length(btrim(reviewed_by)) > 0),
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_evidence_one_acceptance_idx
  ON cbcap.tenant_evidence_review (document_id)
  WHERE decision = 'accepted';

CREATE INDEX IF NOT EXISTS tenant_evidence_document_tenant_run_idx
  ON cbcap.tenant_evidence_document (tenant_id, submitted_in_run_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS tenant_evidence_document_content_idx
  ON cbcap.tenant_evidence_document (tenant_id, content_hash);

CREATE INDEX IF NOT EXISTS tenant_evidence_document_geographies_gin
  ON cbcap.tenant_evidence_document USING gin (geography_ids);

CREATE INDEX IF NOT EXISTS tenant_evidence_review_document_idx
  ON cbcap.tenant_evidence_review (tenant_id, document_id, reviewed_at DESC);

ALTER TABLE cbcap.tenant_evidence_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.tenant_evidence_document FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap.tenant_evidence_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.tenant_evidence_review FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_evidence_document_tenant_isolation
  ON cbcap.tenant_evidence_document;
CREATE POLICY tenant_evidence_document_tenant_isolation
  ON cbcap.tenant_evidence_document
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS tenant_evidence_review_tenant_isolation
  ON cbcap.tenant_evidence_review;
CREATE POLICY tenant_evidence_review_tenant_isolation
  ON cbcap.tenant_evidence_review
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

CREATE OR REPLACE FUNCTION cbcap.validate_tenant_evidence_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document_record cbcap.tenant_evidence_document%ROWTYPE;
BEGIN
  SELECT * INTO document_record
    FROM cbcap.tenant_evidence_document
   WHERE id = NEW.document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'tenant evidence document % is missing or not visible in the active tenant scope',
      NEW.document_id;
  END IF;

  IF document_record.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant evidence review tenant does not match document tenant';
  END IF;

  IF NEW.decision = 'accepted' AND document_record.admission_state <> 'eligible_for_review' THEN
    RAISE EXCEPTION 'only eligible tenant evidence can be accepted';
  END IF;

  IF NEW.decision = 'needs_revision' AND document_record.admission_state = 'rejected' THEN
    RAISE EXCEPTION 'rejected tenant evidence cannot be changed to needs_revision';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cbcap.prevent_tenant_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '%.% is append-only tenant evidence history; submit a new document version or review event instead of mutating history',
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS tenant_evidence_review_guard ON cbcap.tenant_evidence_review;
CREATE TRIGGER tenant_evidence_review_guard
BEFORE INSERT ON cbcap.tenant_evidence_review
FOR EACH ROW EXECUTE FUNCTION cbcap.validate_tenant_evidence_review();

DROP TRIGGER IF EXISTS tenant_evidence_document_append_only ON cbcap.tenant_evidence_document;
CREATE TRIGGER tenant_evidence_document_append_only
BEFORE UPDATE OR DELETE ON cbcap.tenant_evidence_document
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_tenant_evidence_mutation();

DROP TRIGGER IF EXISTS tenant_evidence_review_append_only ON cbcap.tenant_evidence_review;
CREATE TRIGGER tenant_evidence_review_append_only
BEFORE UPDATE OR DELETE ON cbcap.tenant_evidence_review
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_tenant_evidence_mutation();

COMMENT ON TABLE cbcap.tenant_evidence_document IS
  'Tenant-private immutable metadata for organization evidence already stored in a private versioned KMS-encrypted object. This table is not part of the public Evidence Gateway.';

COMMENT ON TABLE cbcap.tenant_evidence_review IS
  'Append-only human review decisions for tenant-private evidence. Accepted evidence remains tenant-private unless a separate governed publication workflow explicitly creates a public artifact.';

COMMIT;
