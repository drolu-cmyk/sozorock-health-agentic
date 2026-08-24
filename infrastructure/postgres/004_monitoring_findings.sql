BEGIN;

CREATE TABLE IF NOT EXISTS cbcap_monitor_findings (
  id uuid NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  finding_key text NOT NULL CHECK (finding_key ~ '^sha256:[0-9a-f]{64}$'),
  monitor_id text NOT NULL CHECK (length(btrim(monitor_id)) > 0),
  subject_id text NOT NULL CHECK (length(btrim(subject_id)) > 0),
  geography_id text,
  kind text NOT NULL CHECK (kind IN (
    'evidence_release','planning_document','funding_opportunity','workflow_commitment','evidence_expiry'
  )),
  status text NOT NULL CHECK (status IN ('change_detected','attention_required','blocked')),
  reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes)='array' AND jsonb_array_length(reason_codes)>0),
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changed_fields)='array'),
  baseline_fingerprint text CHECK (baseline_fingerprint IS NULL OR baseline_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  current_fingerprint text CHECK (current_fingerprint IS NULL OR current_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  current_state text,
  current_deadline date,
  current_valid_through date,
  source_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_entity_ids)='array'),
  as_of date NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, finding_key)
);

CREATE INDEX IF NOT EXISTS cbcap_monitor_findings_monitor_idx
  ON cbcap_monitor_findings (tenant_id, monitor_id, recorded_at DESC, id);
CREATE INDEX IF NOT EXISTS cbcap_monitor_findings_subject_idx
  ON cbcap_monitor_findings (tenant_id, subject_id, kind, recorded_at DESC, id);

CREATE OR REPLACE FUNCTION deny_cbcap_monitor_finding_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CB-CAP monitoring findings are append-only';
END;
$$;

DROP TRIGGER IF EXISTS cbcap_monitor_findings_append_only ON cbcap_monitor_findings;
CREATE TRIGGER cbcap_monitor_findings_append_only
BEFORE UPDATE OR DELETE ON cbcap_monitor_findings
FOR EACH ROW EXECUTE FUNCTION deny_cbcap_monitor_finding_mutation();

ALTER TABLE cbcap_monitor_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_monitor_findings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cbcap_monitor_findings_tenant_scope ON cbcap_monitor_findings;
CREATE POLICY cbcap_monitor_findings_tenant_scope ON cbcap_monitor_findings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

COMMENT ON TABLE cbcap_monitor_findings IS
  'Append-only actionable or blocked monitoring findings. No source content is copied here; findings carry governed source identifiers and fingerprints only.';

COMMIT;