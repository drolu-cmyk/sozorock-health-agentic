BEGIN;

CREATE TABLE IF NOT EXISTS cbcap_learning_trajectory (
  id uuid NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  run_id text NOT NULL CHECK (length(btrim(run_id)) > 0),
  geography_id text NOT NULL CHECK (length(btrim(geography_id)) > 0),
  stage text NOT NULL CHECK (stage IN (
    'geography_resolution','evidence_loading','public_evidence','barrier_classification',
    'planning_alignment','funding_source_validation','funding_criterion','funding_fit',
    'visualization_spec','scenario_projection','human_review','institutional_memory',
    'monitoring','publication_gate'
  )),
  actor_type text NOT NULL CHECK (actor_type IN ('deterministic','agent','reviewer','system')),
  actor_name text NOT NULL CHECK (length(btrim(actor_name)) > 0),
  actor_version text NOT NULL CHECK (length(btrim(actor_version)) > 0),
  entity_id text NOT NULL CHECK (length(btrim(entity_id)) > 0),
  outcome text NOT NULL CHECK (length(btrim(outcome)) > 0),
  outcome_class text NOT NULL CHECK (outcome_class IN (
    'accepted','rejected','blocked','review_required','completed','unknown','error'
  )),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes)='array'),
  source_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_entity_ids)='array'),
  tool_names jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tool_names)='array'),
  input_state_hash text CHECK (input_state_hash IS NULL OR input_state_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_state_hash text CHECK (output_state_hash IS NULL OR output_state_hash ~ '^sha256:[0-9a-f]{64}$'),
  model_provider text,
  model_name text,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT cbcap_learning_model_identity CHECK (
    (model_provider IS NULL AND model_name IS NULL)
    OR (model_provider IS NOT NULL AND model_name IS NOT NULL)
  ),
  CONSTRAINT cbcap_learning_model_accounting CHECK (
    (input_tokens = 0 AND output_tokens = 0 AND estimated_cost_usd = 0)
    OR (model_provider IS NOT NULL AND model_name IS NOT NULL)
  ),
  CONSTRAINT cbcap_learning_deterministic_no_model CHECK (
    actor_type <> 'deterministic'
    OR (
      model_provider IS NULL AND model_name IS NULL
      AND input_tokens = 0 AND output_tokens = 0 AND estimated_cost_usd = 0
    )
  )
);

CREATE INDEX IF NOT EXISTS cbcap_learning_trajectory_run_idx
  ON cbcap_learning_trajectory (tenant_id, run_id, occurred_at DESC, id);
CREATE INDEX IF NOT EXISTS cbcap_learning_trajectory_stage_idx
  ON cbcap_learning_trajectory (tenant_id, geography_id, stage, outcome_class, occurred_at DESC);

CREATE TABLE IF NOT EXISTS cbcap_learning_evaluations (
  id uuid NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  trajectory_event_id uuid NOT NULL,
  label text NOT NULL CHECK (label IN (
    'correct','incorrect','incomplete','unsafe','source_error','scope_error','needs_human_judgment'
  )),
  reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes)='array' AND jsonb_array_length(reason_codes)>0),
  evaluator_id text NOT NULL CHECK (length(btrim(evaluator_id)) > 0),
  evaluator_type text NOT NULL CHECK (evaluator_type IN ('human','deterministic_eval','model_eval')),
  evaluator_version text NOT NULL CHECK (length(btrim(evaluator_version)) > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT cbcap_learning_evaluation_event_fk
    FOREIGN KEY (tenant_id, trajectory_event_id)
    REFERENCES cbcap_learning_trajectory (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS cbcap_learning_evaluations_event_idx
  ON cbcap_learning_evaluations (tenant_id, trajectory_event_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS cbcap_learning_corrections (
  id uuid NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  trajectory_event_id uuid NOT NULL,
  corrected_entity_id text NOT NULL CHECK (length(btrim(corrected_entity_id)) > 0),
  correction_type text NOT NULL CHECK (correction_type IN (
    'source_selection','geography_scope','extraction','classification','funding_reasoning',
    'scenario_assumption','review_decision','visualization_choice','other'
  )),
  reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes)='array' AND jsonb_array_length(reason_codes)>0),
  correction_summary text NOT NULL CHECK (length(btrim(correction_summary)) > 0),
  corrected_by text NOT NULL CHECK (length(btrim(corrected_by)) > 0),
  corrected_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT cbcap_learning_correction_event_fk
    FOREIGN KEY (tenant_id, trajectory_event_id)
    REFERENCES cbcap_learning_trajectory (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS cbcap_learning_corrections_event_idx
  ON cbcap_learning_corrections (tenant_id, trajectory_event_id, corrected_at DESC, id);

CREATE TABLE IF NOT EXISTS cbcap_learning_candidates (
  id uuid NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  target_type text NOT NULL CHECK (target_type IN (
    'prompt_change','policy_change','tool_routing_change','model_routing_change','regression_case','code_change'
  )),
  target_id text NOT NULL CHECK (length(btrim(target_id)) > 0),
  summary text NOT NULL CHECK (length(btrim(summary)) > 0),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  artifact_ref text NOT NULL CHECK (length(btrim(artifact_ref)) > 0),
  evaluation_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evaluation_ids)='array'),
  correction_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(correction_ids)='array'),
  evidence_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_entity_ids)='array'),
  status text NOT NULL DEFAULT 'proposed' CHECK (status='proposed'),
  proposed_by text NOT NULL CHECK (length(btrim(proposed_by)) > 0),
  proposed_by_actor_type text NOT NULL CHECK (proposed_by_actor_type IN ('human','agent')),
  proposed_at timestamptz NOT NULL,
  automatic_application_allowed boolean NOT NULL DEFAULT false CHECK (automatic_application_allowed=false),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT cbcap_learning_candidate_evidence_required CHECK (
    jsonb_array_length(evaluation_ids) + jsonb_array_length(correction_ids) > 0
  )
);

CREATE INDEX IF NOT EXISTS cbcap_learning_candidates_target_idx
  ON cbcap_learning_candidates (tenant_id, target_type, target_id, proposed_at DESC, id);

CREATE OR REPLACE FUNCTION validate_cbcap_learning_candidate_refs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(NEW.evaluation_ids) AS ref(value)
     WHERE NOT EXISTS (
       SELECT 1
         FROM cbcap_learning_evaluations evaluation
        WHERE evaluation.tenant_id = NEW.tenant_id
          AND evaluation.id::text = ref.value
     )
  ) THEN
    RAISE EXCEPTION 'learning candidate references an unknown or cross-tenant evaluation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(NEW.correction_ids) AS ref(value)
     WHERE NOT EXISTS (
       SELECT 1
         FROM cbcap_learning_corrections correction
        WHERE correction.tenant_id = NEW.tenant_id
          AND correction.id::text = ref.value
     )
  ) THEN
    RAISE EXCEPTION 'learning candidate references an unknown or cross-tenant correction';
  END IF;

  IF (
    SELECT count(*) FROM jsonb_array_elements_text(NEW.evaluation_ids)
  ) <> (
    SELECT count(DISTINCT value) FROM jsonb_array_elements_text(NEW.evaluation_ids) AS ref(value)
  ) THEN
    RAISE EXCEPTION 'learning candidate evaluation references must be unique';
  END IF;

  IF (
    SELECT count(*) FROM jsonb_array_elements_text(NEW.correction_ids)
  ) <> (
    SELECT count(DISTINCT value) FROM jsonb_array_elements_text(NEW.correction_ids) AS ref(value)
  ) THEN
    RAISE EXCEPTION 'learning candidate correction references must be unique';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cbcap_learning_candidate_reference_guard ON cbcap_learning_candidates;
CREATE TRIGGER cbcap_learning_candidate_reference_guard
BEFORE INSERT ON cbcap_learning_candidates
FOR EACH ROW EXECUTE FUNCTION validate_cbcap_learning_candidate_refs();

CREATE TABLE IF NOT EXISTS cbcap_learning_candidate_reviews (
  id uuid NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  candidate_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  status text NOT NULL CHECK (status IN ('approved_candidate','rejected_candidate')),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  reviewed_by text NOT NULL CHECK (length(btrim(reviewed_by)) > 0),
  reviewed_at timestamptz NOT NULL,
  automatic_application_allowed boolean NOT NULL DEFAULT false CHECK (automatic_application_allowed=false),
  application_state text NOT NULL DEFAULT 'not_applied' CHECK (application_state='not_applied'),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT cbcap_learning_candidate_review_fk
    FOREIGN KEY (tenant_id, candidate_id)
    REFERENCES cbcap_learning_candidates (tenant_id, id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, candidate_id)
);

CREATE OR REPLACE FUNCTION deny_cbcap_learning_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CB-CAP learning and evaluation memory is append-only';
END;
$$;

DROP TRIGGER IF EXISTS cbcap_learning_trajectory_append_only ON cbcap_learning_trajectory;
CREATE TRIGGER cbcap_learning_trajectory_append_only
BEFORE UPDATE OR DELETE ON cbcap_learning_trajectory
FOR EACH ROW EXECUTE FUNCTION deny_cbcap_learning_mutation();

DROP TRIGGER IF EXISTS cbcap_learning_evaluations_append_only ON cbcap_learning_evaluations;
CREATE TRIGGER cbcap_learning_evaluations_append_only
BEFORE UPDATE OR DELETE ON cbcap_learning_evaluations
FOR EACH ROW EXECUTE FUNCTION deny_cbcap_learning_mutation();

DROP TRIGGER IF EXISTS cbcap_learning_corrections_append_only ON cbcap_learning_corrections;
CREATE TRIGGER cbcap_learning_corrections_append_only
BEFORE UPDATE OR DELETE ON cbcap_learning_corrections
FOR EACH ROW EXECUTE FUNCTION deny_cbcap_learning_mutation();

DROP TRIGGER IF EXISTS cbcap_learning_candidates_append_only ON cbcap_learning_candidates;
CREATE TRIGGER cbcap_learning_candidates_append_only
BEFORE UPDATE OR DELETE ON cbcap_learning_candidates
FOR EACH ROW EXECUTE FUNCTION deny_cbcap_learning_mutation();

DROP TRIGGER IF EXISTS cbcap_learning_candidate_reviews_append_only ON cbcap_learning_candidate_reviews;
CREATE TRIGGER cbcap_learning_candidate_reviews_append_only
BEFORE UPDATE OR DELETE ON cbcap_learning_candidate_reviews
FOR EACH ROW EXECUTE FUNCTION deny_cbcap_learning_mutation();

ALTER TABLE cbcap_learning_trajectory ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_learning_trajectory FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap_learning_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_learning_evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap_learning_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_learning_corrections FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap_learning_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_learning_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE cbcap_learning_candidate_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbcap_learning_candidate_reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cbcap_learning_trajectory_tenant_scope ON cbcap_learning_trajectory;
CREATE POLICY cbcap_learning_trajectory_tenant_scope ON cbcap_learning_trajectory
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
DROP POLICY IF EXISTS cbcap_learning_evaluations_tenant_scope ON cbcap_learning_evaluations;
CREATE POLICY cbcap_learning_evaluations_tenant_scope ON cbcap_learning_evaluations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
DROP POLICY IF EXISTS cbcap_learning_corrections_tenant_scope ON cbcap_learning_corrections;
CREATE POLICY cbcap_learning_corrections_tenant_scope ON cbcap_learning_corrections
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
DROP POLICY IF EXISTS cbcap_learning_candidates_tenant_scope ON cbcap_learning_candidates;
CREATE POLICY cbcap_learning_candidates_tenant_scope ON cbcap_learning_candidates
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
DROP POLICY IF EXISTS cbcap_learning_candidate_reviews_tenant_scope ON cbcap_learning_candidate_reviews;
CREATE POLICY cbcap_learning_candidate_reviews_tenant_scope ON cbcap_learning_candidate_reviews
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

COMMENT ON TABLE cbcap_learning_trajectory IS
  'Append-only structured execution trajectory for evaluation. Raw external content and chat transcripts are excluded.';
COMMENT ON TABLE cbcap_learning_evaluations IS
  'Append-only quality labels attached to immutable trajectory events.';
COMMENT ON TABLE cbcap_learning_corrections IS
  'Append-only human corrections that may become governed regression evidence.';
COMMENT ON TABLE cbcap_learning_candidates IS
  'Proposed improvement references only. Database validation enforces same-tenant evaluation/correction provenance; executable patches and autonomous application are not permitted.';
COMMENT ON TABLE cbcap_learning_candidate_reviews IS
  'Append-only human review of learning candidates. Approval does not apply a production change automatically.';

COMMIT;