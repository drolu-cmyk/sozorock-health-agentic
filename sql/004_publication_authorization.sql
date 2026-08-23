BEGIN;

CREATE TABLE IF NOT EXISTS cbcap.publication_authorization (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  run_id text NOT NULL CHECK (length(btrim(run_id)) > 0),
  geography_id text NOT NULL CHECK (length(btrim(geography_id)) > 0),
  source_state_hash text NOT NULL CHECK (source_state_hash ~ '^sha256:[0-9a-fA-F]{64}$'),
  approved_state_hash text NOT NULL CHECK (approved_state_hash ~ '^sha256:[0-9a-fA-F]{64}$'),
  decision_memory_id text NOT NULL REFERENCES cbcap.decision_memory(id) ON DELETE RESTRICT,
  review_decision_id text NOT NULL CHECK (length(btrim(review_decision_id)) > 0),
  evidence_entity_ids jsonb NOT NULL CHECK (
    jsonb_typeof(evidence_entity_ids) = 'array'
    AND jsonb_array_length(evidence_entity_ids) > 0
  ),
  reason_codes jsonb NOT NULL CHECK (
    jsonb_typeof(reason_codes) = 'array'
    AND jsonb_array_length(reason_codes) > 0
  ),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  decided_by text NOT NULL CHECK (length(btrim(decided_by)) > 0),
  actor_role text NOT NULL CHECK (actor_role IN ('reviewer', 'admin')),
  authorization_grant_id text NOT NULL CHECK (length(btrim(authorization_grant_id)) > 0),
  authorization_issuer text NOT NULL CHECK (length(btrim(authorization_issuer)) > 0),
  authorization_capability text NOT NULL DEFAULT 'approve_publication'
    CHECK (authorization_capability = 'approve_publication'),
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id),
  CHECK (source_state_hash <> approved_state_hash)
);

CREATE INDEX IF NOT EXISTS publication_authorization_tenant_run_recent_idx
  ON cbcap.publication_authorization (tenant_id, run_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS publication_authorization_tenant_geography_recent_idx
  ON cbcap.publication_authorization (tenant_id, geography_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS publication_authorization_memory_idx
  ON cbcap.publication_authorization (decision_memory_id);

ALTER TABLE cbcap.publication_authorization ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.publication_authorization FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS publication_authorization_tenant_isolation
  ON cbcap.publication_authorization;
CREATE POLICY publication_authorization_tenant_isolation
  ON cbcap.publication_authorization
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
  );

CREATE OR REPLACE FUNCTION cbcap.validate_publication_authorization_memory()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  memory_record cbcap.decision_memory%ROWTYPE;
BEGIN
  SELECT * INTO memory_record
    FROM cbcap.decision_memory
   WHERE id = NEW.decision_memory_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'publication authorization decision memory % is missing or not visible in the active tenant scope',
      NEW.decision_memory_id;
  END IF;

  IF memory_record.tenant_id <> NEW.tenant_id
    OR memory_record.geography_id <> NEW.geography_id
    OR memory_record.decision_type <> 'publication_decision'
    OR memory_record.subject_type <> 'county_run'
    OR memory_record.subject_id <> NEW.run_id
    OR memory_record.outcome <> 'accepted'
    OR memory_record.status <> 'reviewed'
    OR memory_record.decided_by <> NEW.decided_by
    OR memory_record.decided_at <> NEW.decided_at THEN
    RAISE EXCEPTION
      'publication authorization does not match its reviewed institutional memory record';
  END IF;

  IF NOT (memory_record.related_entity_ids ? NEW.review_decision_id) THEN
    RAISE EXCEPTION
      'publication authorization review decision is not linked from institutional memory';
  END IF;

  IF NOT (
    memory_record.evidence_entity_ids @> NEW.evidence_entity_ids
    AND memory_record.evidence_entity_ids <@ NEW.evidence_entity_ids
  ) THEN
    RAISE EXCEPTION
      'publication authorization evidence does not match institutional memory evidence';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_authorization_memory_guard
  ON cbcap.publication_authorization;
CREATE TRIGGER publication_authorization_memory_guard
BEFORE INSERT ON cbcap.publication_authorization
FOR EACH ROW EXECUTE FUNCTION cbcap.validate_publication_authorization_memory();

DROP TRIGGER IF EXISTS publication_authorization_append_only
  ON cbcap.publication_authorization;
CREATE TRIGGER publication_authorization_append_only
BEFORE UPDATE OR DELETE ON cbcap.publication_authorization
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_immutable_record_mutation();

COMMENT ON TABLE cbcap.publication_authorization IS
  'Tenant-private append-only publication authorization ledger. One approval is allowed per tenant/run and each row is bound to reviewed publication memory plus the application authorization grant used.';

COMMENT ON COLUMN cbcap.publication_authorization.source_state_hash IS
  'SHA-256 of the exact pre-approval CountyRunState reviewed by the authorized principal.';

COMMENT ON COLUMN cbcap.publication_authorization.approved_state_hash IS
  'SHA-256 of the CountyRunState after the approval ReviewDecision and publication_approved flag are applied.';

COMMENT ON COLUMN cbcap.publication_authorization.authorization_grant_id IS
  'Identifier of the trusted application-layer authorization grant used for this publication approval.';

COMMIT;
