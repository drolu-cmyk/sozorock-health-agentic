BEGIN;

CREATE TABLE IF NOT EXISTS cbcap_workspace_items (
  id uuid NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  workspace_id text NOT NULL CHECK (length(btrim(workspace_id)) > 0),
  geography_id text,
  item_type text NOT NULL CHECK (item_type IN ('draft','comment','task','saved_view','review_question')),
  title text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (length(btrim(status)) > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_by text NOT NULL CHECK (length(btrim(updated_by)) > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, id)
);

CREATE INDEX IF NOT EXISTS cbcap_workspace_items_scope_idx
  ON cbcap_workspace_items (tenant_id, workspace_id, status, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS cbcap_workspace_events (
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  workspace_id text NOT NULL CHECK (length(btrim(workspace_id)) > 0),
  item_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  event_type text NOT NULL CHECK (event_type IN ('workspace_item_created','workspace_item_updated')),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, item_id, version),
  CONSTRAINT cbcap_workspace_event_item_fk
    FOREIGN KEY (tenant_id, workspace_id, item_id)
    REFERENCES cbcap_workspace_items (tenant_id, workspace_id, id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION deny_cbcap_workspace_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cbcap_workspace_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS cbcap_workspace_events_append_only ON cbcap_workspace_events;
CREATE TRIGGER cbcap_workspace_events_append_only
BEFORE UPDATE OR DELETE ON cbcap_workspace_events
FOR EACH ROW
EXECUTE FUNCTION deny_cbcap_workspace_event_mutation();

CREATE TABLE IF NOT EXISTS cbcap_institutional_memory (
  id uuid NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  geography_id text NOT NULL CHECK (length(btrim(geography_id)) > 0),
  decision_type text NOT NULL CHECK (decision_type IN (
    'planning_interpretation','funding_fit','partner_requirement','scenario_decision',
    'evidence_correction','publication_decision','monitoring_commitment'
  )),
  subject_type text NOT NULL CHECK (length(btrim(subject_type)) > 0),
  subject_id text NOT NULL CHECK (length(btrim(subject_id)) > 0),
  outcome text NOT NULL CHECK (outcome IN ('accepted','rejected','needs_revision','deferred','superseded')),
  reason_codes jsonb NOT NULL,
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  evidence_entity_ids jsonb NOT NULL,
  related_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('proposed','reviewed','rejected','superseded')),
  applicability text NOT NULL CHECK (applicability IN ('context_specific','reusable','expired')),
  proposed_by text NOT NULL CHECK (length(btrim(proposed_by)) > 0),
  proposed_at timestamptz NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  review_decision text CHECK (review_decision IS NULL OR review_decision IN ('approve','reject','supersede')),
  review_rationale text,
  source_proposal_id uuid,
  supersedes_memory_id uuid,
  expires_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT cbcap_memory_source_proposal_fk
    FOREIGN KEY (tenant_id, source_proposal_id)
    REFERENCES cbcap_institutional_memory (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT cbcap_memory_supersedes_fk
    FOREIGN KEY (tenant_id, supersedes_memory_id)
    REFERENCES cbcap_institutional_memory (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT cbcap_memory_review_fields CHECK (
    (status='proposed' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_decision IS NULL)
    OR
    (status IN ('reviewed','rejected','superseded') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_decision IS NOT NULL)
  ),
  CONSTRAINT cbcap_memory_evidence_nonempty CHECK (jsonb_typeof(evidence_entity_ids)='array' AND jsonb_array_length(evidence_entity_ids) > 0),
  CONSTRAINT cbcap_memory_reason_nonempty CHECK (jsonb_typeof(reason_codes)='array' AND jsonb_array_length(reason_codes) > 0)
);

CREATE INDEX IF NOT EXISTS cbcap_institutional_memory_query_idx
  ON cbcap_institutional_memory (tenant_id, geography_id, decision_type, subject_id, status, reviewed_at DESC, proposed_at DESC);

CREATE OR REPLACE FUNCTION deny_cbcap_institutional_memory_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cbcap_institutional_memory is append-only';
END;
$$;

DROP TRIGGER IF EXISTS cbcap_institutional_memory_append_only ON cbcap_institutional_memory;
CREATE TRIGGER cbcap_institutional_memory_append_only
BEFORE UPDATE OR DELETE ON cbcap_institutional_memory
FOR EACH ROW
EXECUTE FUNCTION deny_cbcap_institutional_memory_mutation();

ALTER TABLE cbcap_workspace_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_workspace_items FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap_workspace_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_workspace_events FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap_institutional_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_institutional_memory FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cbcap_workspace_items_tenant_scope ON cbcap_workspace_items;
CREATE POLICY cbcap_workspace_items_tenant_scope ON cbcap_workspace_items
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS cbcap_workspace_events_tenant_scope ON cbcap_workspace_events;
CREATE POLICY cbcap_workspace_events_tenant_scope ON cbcap_workspace_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

DROP POLICY IF EXISTS cbcap_institutional_memory_tenant_scope ON cbcap_institutional_memory;
CREATE POLICY cbcap_institutional_memory_tenant_scope ON cbcap_institutional_memory
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

COMMENT ON TABLE cbcap_workspace_items IS
  'Mutable tenant collaboration state with optimistic versions. Every mutation must also append a cbcap_workspace_events row.';
COMMENT ON TABLE cbcap_workspace_events IS
  'Append-only workspace collaboration audit log. Production application roles must not own this table or hold BYPASSRLS.';
COMMENT ON TABLE cbcap_institutional_memory IS
  'Append-only tenant institutional memory. Reviewed knowledge is represented by new immutable records; ordinary workspace state is never promoted automatically.';

COMMIT;
