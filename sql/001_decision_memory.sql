BEGIN;

CREATE SCHEMA IF NOT EXISTS cbcap;

CREATE TABLE IF NOT EXISTS cbcap.decision_memory (
  id text PRIMARY KEY,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  geography_id text NOT NULL CHECK (length(btrim(geography_id)) > 0),
  decision_type text NOT NULL CHECK (decision_type IN (
    'planning_interpretation',
    'funding_fit',
    'partner_requirement',
    'scenario_decision',
    'evidence_correction',
    'publication_decision'
  )),
  subject_type text NOT NULL CHECK (length(btrim(subject_type)) > 0),
  subject_id text NOT NULL CHECK (length(btrim(subject_id)) > 0),
  outcome text NOT NULL CHECK (outcome IN (
    'accepted',
    'rejected',
    'needs_revision',
    'deferred',
    'superseded'
  )),
  reason_codes jsonb NOT NULL CHECK (
    jsonb_typeof(reason_codes) = 'array'
    AND jsonb_array_length(reason_codes) > 0
  ),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  evidence_entity_ids jsonb NOT NULL CHECK (
    jsonb_typeof(evidence_entity_ids) = 'array'
    AND jsonb_array_length(evidence_entity_ids) > 0
  ),
  related_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(related_entity_ids) = 'array'),
  missing_requirements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_requirements) = 'array'),
  decided_by text NOT NULL CHECK (length(btrim(decided_by)) > 0),
  decided_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'reviewed', 'superseded')),
  applicability text NOT NULL CHECK (applicability IN ('context_specific', 'reusable', 'expired')),
  supersedes_memory_id text NULL REFERENCES cbcap.decision_memory(id) ON DELETE RESTRICT,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status <> 'superseded') OR outcome = 'superseded'),
  CHECK ((outcome <> 'superseded') OR supersedes_memory_id IS NOT NULL),
  CHECK ((applicability <> 'expired') OR expires_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS decision_memory_tenant_geography_recent_idx
  ON cbcap.decision_memory (tenant_id, geography_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS decision_memory_tenant_subject_recent_idx
  ON cbcap.decision_memory (tenant_id, subject_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS decision_memory_tenant_type_recent_idx
  ON cbcap.decision_memory (tenant_id, decision_type, decided_at DESC);

CREATE INDEX IF NOT EXISTS decision_memory_reviewed_reusable_idx
  ON cbcap.decision_memory (tenant_id, geography_id, decision_type, decided_at DESC)
  WHERE status = 'reviewed' AND applicability = 'reusable';

ALTER TABLE cbcap.decision_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap.decision_memory FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_memory_tenant_isolation ON cbcap.decision_memory;
CREATE POLICY decision_memory_tenant_isolation
  ON cbcap.decision_memory
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')
  );

COMMENT ON TABLE cbcap.decision_memory IS
  'Tenant-private reviewed planning decisions and proposals. This table stores structured institutional memory, not conversation transcripts.';

COMMENT ON COLUMN cbcap.decision_memory.evidence_entity_ids IS
  'Evidence Graph entity IDs that support the decision. Reviewed memory should remain traceable to governed evidence.';

COMMENT ON COLUMN cbcap.decision_memory.missing_requirements IS
  'Structured missing evidence, partner, capability, or prerequisite identifiers preserved for future planning cycles.';

COMMIT;
