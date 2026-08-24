const crypto = require('crypto');
const {
  CANDIDATE_TARGETS,
  CORRECTION_TYPES,
  EVALUATION_LABELS,
  validateTrajectory,
} = require('./learning-memory');
const { permissionDecision, validateWorkspaceActor } = require('./workspace-identity');

function requiredString(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function stringList(value, label, { min = 0, max = 200 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain between ${min} and ${max} items.`);
  }
  const normalized = value.map((item, index) => requiredString(item, `${label}[${index}]`, 500));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return normalized;
}

function sameTenant(actorInput, tenantId) {
  const actor = validateWorkspaceActor(actorInput);
  if (actor.tenantId !== tenantId) throw new Error('Learning-memory actor tenant does not match memory tenant.');
  return actor;
}

function correctionActor(actorInput, tenantId) {
  const actor = sameTenant(actorInput, tenantId);
  const decision = permissionDecision(actor, 'cbcap.plan.review');
  if (!decision.ok) throw new Error(`Learning correction is not authorized: ${decision.code}.`);
  return actor;
}

function candidateReviewer(actorInput, tenantId) {
  const actor = sameTenant(actorInput, tenantId);
  if (actor.actorType !== 'human' || actor.role !== 'foundation_reviewer' || !['owner', 'contributor'].includes(actor.access)) {
    throw new Error('Learning candidate review requires foundation_reviewer write authority.');
  }
  return actor;
}

function iso(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function json(value, fallback = []) {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function mapTrajectory(row) {
  if (!row) return null;
  return {
    id: String(row.id), tenantId: row.tenant_id, runId: row.run_id, geographyId: row.geography_id,
    stage: row.stage, actorType: row.actor_type, actorName: row.actor_name, actorVersion: row.actor_version,
    entityId: row.entity_id, outcome: row.outcome, outcomeClass: row.outcome_class,
    reasonCodes: json(row.reason_codes), sourceEntityIds: json(row.source_entity_ids), toolNames: json(row.tool_names),
    inputStateHash: row.input_state_hash, outputStateHash: row.output_state_hash,
    modelProvider: row.model_provider, modelName: row.model_name,
    inputTokens: Number(row.input_tokens || 0), outputTokens: Number(row.output_tokens || 0),
    estimatedCostUsd: Number(row.estimated_cost_usd || 0), occurredAt: iso(row.occurred_at), recordedAt: iso(row.recorded_at),
  };
}

function mapEvaluation(row) {
  if (!row) return null;
  return {
    id: String(row.id), tenantId: row.tenant_id, trajectoryEventId: String(row.trajectory_event_id),
    label: row.label, reasonCodes: json(row.reason_codes), evaluatorId: row.evaluator_id,
    evaluatorType: row.evaluator_type, evaluatorVersion: row.evaluator_version, createdAt: iso(row.created_at),
  };
}

function mapCorrection(row) {
  if (!row) return null;
  return {
    id: String(row.id), tenantId: row.tenant_id, trajectoryEventId: String(row.trajectory_event_id),
    correctedEntityId: row.corrected_entity_id, correctionType: row.correction_type,
    reasonCodes: json(row.reason_codes), correctionSummary: row.correction_summary,
    correctedBy: row.corrected_by, correctedAt: iso(row.corrected_at),
  };
}

function mapCandidate(row) {
  if (!row) return null;
  return {
    id: String(row.id), tenantId: row.tenant_id, targetType: row.target_type, targetId: row.target_id,
    summary: row.summary, rationale: row.rationale, artifactRef: row.artifact_ref,
    evaluationIds: json(row.evaluation_ids), correctionIds: json(row.correction_ids),
    evidenceEntityIds: json(row.evidence_entity_ids), status: row.status,
    proposedBy: row.proposed_by, proposedByActorType: row.proposed_by_actor_type,
    proposedAt: iso(row.proposed_at), automaticApplicationAllowed: row.automatic_application_allowed === true,
  };
}

function mapCandidateReview(row) {
  if (!row) return null;
  return {
    id: String(row.id), tenantId: row.tenant_id, candidateId: String(row.candidate_id),
    decision: row.decision, status: row.status, rationale: row.rationale,
    reviewedBy: row.reviewed_by, reviewedAt: iso(row.reviewed_at),
    automaticApplicationAllowed: row.automatic_application_allowed === true,
    applicationState: row.application_state,
  };
}

class SqlLearningMemory {
  constructor(options = {}) {
    if (typeof options.query !== 'function') throw new Error('SqlLearningMemory requires query(sql, params).');
    this.query = options.query;
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
    this.clock = options.clock || (() => new Date().toISOString());
  }

  async recordTrajectory(input) {
    const event = validateTrajectory(input, this.tenantId);
    const id = crypto.randomUUID();
    const recordedAt = this.clock();
    const result = await this.query(`INSERT INTO cbcap_learning_trajectory
      (id,tenant_id,run_id,geography_id,stage,actor_type,actor_name,actor_version,entity_id,outcome,outcome_class,
       reason_codes,source_entity_ids,tool_names,input_state_hash,output_state_hash,model_provider,model_name,
       input_tokens,output_tokens,estimated_cost_usd,occurred_at,recorded_at)
      VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22::timestamptz,$23::timestamptz)
      RETURNING *`, [id,this.tenantId,event.runId,event.geographyId,event.stage,event.actorType,event.actorName,event.actorVersion,
      event.entityId,event.outcome,event.outcomeClass,JSON.stringify(event.reasonCodes),JSON.stringify(event.sourceEntityIds),
      JSON.stringify(event.toolNames),event.inputStateHash,event.outputStateHash,event.modelProvider,event.modelName,
      event.inputTokens,event.outputTokens,event.estimatedCostUsd,event.occurredAt,recordedAt]);
    return mapTrajectory(result.rows[0]);
  }

  async getTrajectory(eventId) {
    const result = await this.query('SELECT * FROM cbcap_learning_trajectory WHERE tenant_id=$1 AND id=$2::uuid', [this.tenantId,requiredString(eventId,'eventId',128)]);
    return result?.rows?.length ? mapTrajectory(result.rows[0]) : null;
  }

  async evaluate(eventId, input, evaluator = {}) {
    const id = crypto.randomUUID();
    const label = requiredString(input?.label, 'label', 80);
    if (!EVALUATION_LABELS.includes(label)) throw new Error('evaluation label is unsupported.');
    const reasonCodes = stringList(input.reasonCodes, 'reasonCodes', { min: 1, max: 50 });
    const evaluatorType = requiredString(evaluator.type, 'evaluator.type', 40);
    if (!['human','deterministic_eval','model_eval'].includes(evaluatorType)) throw new Error('evaluator.type is unsupported.');
    let evaluatorId;
    if (evaluatorType === 'human') {
      const actor = sameTenant(evaluator.actor, this.tenantId);
      if (actor.actorType !== 'human') throw new Error('Human evaluation requires a human workspace actor.');
      evaluatorId = actor.principalId;
    } else {
      evaluatorId = requiredString(evaluator.id, 'evaluator.id', 240);
    }
    const result = await this.query(`INSERT INTO cbcap_learning_evaluations
      (id,tenant_id,trajectory_event_id,label,reason_codes,evaluator_id,evaluator_type,evaluator_version,created_at)
      SELECT $1::uuid,$2,id,$4,$5::jsonb,$6,$7,$8,$9::timestamptz
        FROM cbcap_learning_trajectory WHERE tenant_id=$2 AND id=$3::uuid
      RETURNING *`, [id,this.tenantId,requiredString(eventId,'eventId',128),label,JSON.stringify(reasonCodes),evaluatorId,evaluatorType,requiredString(evaluator.version,'evaluator.version',120),this.clock()]);
    return result?.rows?.length ? mapEvaluation(result.rows[0]) : null;
  }

  async correct(eventId, input, actorInput) {
    const actor = correctionActor(actorInput, this.tenantId);
    const correctionType = requiredString(input?.correctionType, 'correctionType', 80);
    if (!CORRECTION_TYPES.includes(correctionType)) throw new Error('correctionType is unsupported.');
    const id = crypto.randomUUID();
    const result = await this.query(`INSERT INTO cbcap_learning_corrections
      (id,tenant_id,trajectory_event_id,corrected_entity_id,correction_type,reason_codes,correction_summary,corrected_by,corrected_at)
      SELECT $1::uuid,$2,id,$4,$5,$6::jsonb,$7,$8,$9::timestamptz
        FROM cbcap_learning_trajectory WHERE tenant_id=$2 AND id=$3::uuid
      RETURNING *`, [id,this.tenantId,requiredString(eventId,'eventId',128),requiredString(input.correctedEntityId,'correctedEntityId',240),
      correctionType,JSON.stringify(stringList(input.reasonCodes,'reasonCodes',{min:1,max:50})),requiredString(input.correctionSummary,'correctionSummary',5000),actor.principalId,this.clock()]);
    return result?.rows?.length ? mapCorrection(result.rows[0]) : null;
  }

  async proposeCandidate(input, actorInput) {
    const actor = sameTenant(actorInput, this.tenantId);
    const targetType = requiredString(input?.targetType, 'targetType', 80);
    if (!CANDIDATE_TARGETS.includes(targetType)) throw new Error('learning candidate targetType is unsupported.');
    if (Object.prototype.hasOwnProperty.call(input,'executableContent') || Object.prototype.hasOwnProperty.call(input,'patch')) {
      throw new Error('learning candidates store reviewed references and rationale, not executable content or patches.');
    }
    const evaluationIds = stringList(input.evaluationIds || [], 'evaluationIds', { max: 200 });
    const correctionIds = stringList(input.correctionIds || [], 'correctionIds', { max: 200 });
    if (!evaluationIds.length && !correctionIds.length) throw new Error('learning candidate requires at least one evaluation or correction record.');
    const id = crypto.randomUUID();
    const result = await this.query(`INSERT INTO cbcap_learning_candidates
      (id,tenant_id,target_type,target_id,summary,rationale,artifact_ref,evaluation_ids,correction_ids,evidence_entity_ids,status,
       proposed_by,proposed_by_actor_type,proposed_at,automatic_application_allowed)
      SELECT $1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'proposed',$11,$12,$13::timestamptz,false
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text($8::jsonb) e
          WHERE NOT EXISTS (SELECT 1 FROM cbcap_learning_evaluations x WHERE x.tenant_id=$2 AND x.id=e::uuid)
       )
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text($9::jsonb) c
          WHERE NOT EXISTS (SELECT 1 FROM cbcap_learning_corrections x WHERE x.tenant_id=$2 AND x.id=c::uuid)
       )
      RETURNING *`, [id,this.tenantId,targetType,requiredString(input.targetId,'targetId',240),requiredString(input.summary,'summary',2000),
      requiredString(input.rationale,'rationale',5000),requiredString(input.artifactRef,'artifactRef',1000),JSON.stringify(evaluationIds),JSON.stringify(correctionIds),
      JSON.stringify(stringList(input.evidenceEntityIds || [],'evidenceEntityIds',{max:200})),actor.principalId,actor.actorType,this.clock()]);
    if (!result?.rows?.length) throw new Error('learning candidate references evaluation or correction records outside the active tenant or unknown to the store.');
    return mapCandidate(result.rows[0]);
  }

  async reviewCandidate(candidateId, decision, actorInput, options = {}) {
    const actor = candidateReviewer(actorInput, this.tenantId);
    if (!['approve','reject'].includes(decision)) throw new Error('candidate review decision must be approve or reject.');
    const id = crypto.randomUUID();
    try {
      const result = await this.query(`INSERT INTO cbcap_learning_candidate_reviews
        (id,tenant_id,candidate_id,decision,status,rationale,reviewed_by,reviewed_at,automatic_application_allowed,application_state)
        SELECT $1::uuid,$2,id,$4,CASE WHEN $4='approve' THEN 'approved_candidate' ELSE 'rejected_candidate' END,
               $5,$6,$7::timestamptz,false,'not_applied'
          FROM cbcap_learning_candidates WHERE tenant_id=$2 AND id=$3::uuid
        RETURNING *`, [id,this.tenantId,requiredString(candidateId,'candidateId',128),decision,requiredString(options.rationale,'review rationale',5000),actor.principalId,this.clock()]);
      return result?.rows?.length ? mapCandidateReview(result.rows[0]) : null;
    } catch (error) {
      if (String(error?.code) === '23505') {
        const conflict = new Error('Learning candidate has already been reviewed.');
        conflict.code = 'REVIEW_CONFLICT';
        throw conflict;
      }
      throw error;
    }
  }

  async queryMemory(options = {}) {
    const runId = options.runId ? requiredString(options.runId,'runId',240) : null;
    const stage = options.stage ? requiredString(options.stage,'stage',80) : null;
    const [trajectoryResult,evaluationResult,correctionResult,candidateResult,reviewResult] = await Promise.all([
      this.query(`SELECT * FROM cbcap_learning_trajectory WHERE tenant_id=$1 AND ($2::text IS NULL OR run_id=$2) AND ($3::text IS NULL OR stage=$3) ORDER BY occurred_at,id`,[this.tenantId,runId,stage]),
      this.query('SELECT * FROM cbcap_learning_evaluations WHERE tenant_id=$1 ORDER BY created_at,id',[this.tenantId]),
      this.query('SELECT * FROM cbcap_learning_corrections WHERE tenant_id=$1 ORDER BY corrected_at,id',[this.tenantId]),
      this.query('SELECT * FROM cbcap_learning_candidates WHERE tenant_id=$1 ORDER BY proposed_at,id',[this.tenantId]),
      this.query('SELECT * FROM cbcap_learning_candidate_reviews WHERE tenant_id=$1 ORDER BY reviewed_at,id',[this.tenantId]),
    ]);
    const trajectory = (trajectoryResult.rows || []).map(mapTrajectory);
    const eventIds = new Set(trajectory.map((item) => item.id));
    const reviews = (reviewResult.rows || []).map(mapCandidateReview);
    const candidates = (candidateResult.rows || []).map(mapCandidate).map((candidate) => ({
      ...candidate,
      review: reviews.find((review) => review.candidateId === candidate.id) || null,
    }));
    return {
      tenantId: this.tenantId,
      trajectory,
      evaluations: (evaluationResult.rows || []).map(mapEvaluation).filter((item) => eventIds.has(item.trajectoryEventId)),
      corrections: (correctionResult.rows || []).map(mapCorrection).filter((item) => eventIds.has(item.trajectoryEventId)),
      candidates,
      automaticProductionModification: false,
    };
  }
}

module.exports = {
  SqlLearningMemory,
  mapCandidate,
  mapCandidateReview,
  mapCorrection,
  mapEvaluation,
  mapTrajectory,
};