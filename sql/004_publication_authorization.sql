BEGIN;

CREATE TABLE IF NOT EXISTS cbcap.publication_authorization (
  id text PRIMARY KEY,
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
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, source_state_hash),
  CHECK (source_state_hash <> approved_state_hash)
);

CREATE INDEX IF NOT EXISTS publication_authorization_tenant_run_recent_idx
  ON cbcap.publication_authorization (tenant_id, run_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS publication_authorization_tenant_geography_recent_idx
  ON cbcap.publication_authorization (tenant_id, geography_id, decided_at DESC);

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

DROP TRIGGER IF EXISTS publication_authorization_append_only
  ON cbcap.publication_authorization;
CREATE TRIGGER publication_authorization_append_only
BEFORE UPDATE OR DELETE ON cbcap.publication_authorization
FOR EACH ROW EXECUTE FUNCTION cbcap.prevent_immutable_record_mutation();

COMMENT ON TABLE cbcap.publication_authorization IS
  'Tenant-private append-only publication authorization ledger. Each approval is bound to the exact governed county state reviewed before approval and the canonical state produced by that approval.';

COMMENT ON COLUMN cbcap.publication_authorization.source_state_hash IS
  'SHA-256 of the exact pre-approval CountyRunState reviewed by the authorized principal.';

COMMENT ON COLUMN cbcap.publication_authorization.approved_state_hash IS
  'SHA-256 of the CountyRunState after the approval ReviewDecision and publication_approved flag are applied.';

COMMIT;
