const crypto = require('crypto');
const { permissionDecision, validateWorkspaceActor } = require('./workspace-identity');

const TRAJECTORY_STAGES = Object.freeze([
  'geography_resolution',
  'evidence_loading',
  'public_evidence',
  'barrier_classification',
  'planning_alignment',
  'funding_source_validation',
  'funding_criterion',
  'funding_fit',
  'visualization_spec',
  'scenario_projection',
  'human_review',
  'institutional_memory',
  'monitoring',
  'publication_gate',
]);

const OUTCOME_CLASSES = Object.freeze([
  'accepted',
  'rejected',
  'blocked',
  'review_required',
  'completed',
  'unknown',
  'error',
]);

const EVALUATION_LABELS = Object.freeze([
  'correct',
  'incorrect',
  'incomplete',
  'unsafe',
  'source_error',
  'scope_error',
  'needs_human_judgment',
]);

const CORRECTION_TYPES = Object.freeze([
  'source_selection',
  'geography_scope',
  'extraction',
  'classification',
  'funding_reasoning',
  'scenario_assumption',
  'review_decision',
  'visualization_choice',
  'other',
]);

const CANDIDATE_TARGETS = Object.freeze([
  'prompt_change',
  'policy_change',
  'tool_routing_change',
  'model_routing_change',
  'regression_case',
  'code_change',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requiredString(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function optionalString(value, label, max = 500) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, label, max);
}

function stringList(value, label, { min = 0, max = 200 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain between ${min} and ${max} items.`);
  }
  const normalized = value.map((item, index) => requiredString(item, `${label}[${index}]`, 500));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return normalized;
}

function nonNegativeInteger(value, label) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function nonNegativeNumber(value, label) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function isoTimestamp(value, label) {
  const normalized = requiredString(value, label, 80);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return normalized;
}

function sha256OrNull(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = requiredString(value, label, 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be a sha256 hash.`);
  return normalized;
}

function sameTenant(actorInput, tenantId) {
  const actor = validateWorkspaceActor(actorInput);
  if (actor.tenantId !== tenantId) throw new Error('Learning-memory actor tenant does not match memory tenant.');
  return actor;
}

function requireHumanEvaluator(actorInput, tenantId) {
  const actor = sameTenant(actorInput, tenantId);
  if (actor.actorType !== 'human') throw new Error('Human evaluation requires a human workspace actor.');
  return actor;
}

function requireCorrectionAuthority(actorInput, tenantId) {
  const actor = sameTenant(actorInput, tenantId);
  const decision = permissionDecision(actor, 'cbcap.plan.review');
  if (!decision.ok) throw new Error(`Learning correction is not authorized: ${decision.code}.`);
  return actor;
}

function requireCandidateReviewer(actorInput, tenantId) {
  const actor = sameTenant(actorInput, tenantId);
  if (actor.actorType !== 'human') throw new Error('Learning candidate review requires a human actor.');
  if (actor.role !== 'foundation_reviewer') throw new Error('Learning candidate review requires foundation_reviewer authority.');
  if (!['owner', 'contributor'].includes(actor.access)) throw new Error('Learning candidate review requires write access.');
  return actor;
}

function validateTrajectory(input, tenantId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('trajectory event must be an object.');
  const stage = requiredString(input.stage, 'stage', 80);
  const actorType = requiredString(input.actorType, 'actorType', 40);
  const outcomeClass = requiredString(input.outcomeClass, 'outcomeClass', 40);
  if (!TRAJECTORY_STAGES.includes(stage)) throw new Error('trajectory stage is unsupported.');
  if (!['deterministic', 'agent', 'reviewer', 'system'].includes(actorType)) throw new Error('trajectory actorType is unsupported.');
  if (!OUTCOME_CLASSES.includes(outcomeClass)) throw new Error('trajectory outcomeClass is unsupported.');
  const modelProvider = optionalString(input.modelProvider, 'modelProvider', 120);
  const modelName = optionalString(input.modelName, 'modelName', 160);
  if (Boolean(modelProvider) !== Boolean(modelName)) throw new Error('model identity requires both provider and model name.');
  const inputTokens = nonNegativeInteger(input.inputTokens, 'inputTokens');
  const outputTokens = nonNegativeInteger(input.outputTokens, 'outputTokens');
  const estimatedCostUsd = nonNegativeNumber(input.estimatedCostUsd, 'estimatedCostUsd');
  const hasModelAccounting = inputTokens > 0 || outputTokens > 0 || estimatedCostUsd > 0;
  if (hasModelAccounting && !modelProvider) throw new Error('model token or cost accounting requires model identity.');
  if (actorType === 'deterministic' && (modelProvider || hasModelAccounting)) {
    throw new Error('deterministic trajectory events cannot report model identity, tokens, or model cost.');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'rawContent') || Object.prototype.hasOwnProperty.call(input, 'transcript')) {
    throw new Error('raw content and transcripts do not belong in learning trajectory records.');
  }
  return {
    tenantId,
    runId: requiredString(input.runId, 'runId', 240),
    geographyId: requiredString(input.geographyId, 'geographyId', 240),
    stage,
    actorType,
    actorName: requiredString(input.actorName, 'actorName', 240),
    actorVersion: requiredString(input.actorVersion, 'actorVersion', 120),
    entityId: requiredString(input.entityId, 'entityId', 240),
    outcome: requiredString(input.outcome, 'outcome', 1000),
    outcomeClass,
    reasonCodes: stringList(input.reasonCodes || [], 'reasonCodes', { max: 50 }),
    sourceEntityIds: stringList(input.sourceEntityIds || [], 'sourceEntityIds', { max: 200 }),
    toolNames: stringList(input.toolNames || [], 'toolNames', { max: 50 }),
    inputStateHash: sha256OrNull(input.inputStateHash, 'inputStateHash'),
    outputStateHash: sha256OrNull(input.outputStateHash, 'outputStateHash'),
    modelProvider,
    modelName,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    occurredAt: isoTimestamp(input.occurredAt, 'occurredAt'),
  };
}

class InMemoryLearningMemory {
  constructor(options = {}) {
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
    this.clock = options.clock || (() => new Date().toISOString());
    this.trajectory = [];
    this.evaluations = [];
    this.corrections = [];
    this.candidates = [];
    this.candidateReviews = [];
  }

  recordTrajectory(input) {
    const record = {
      id: crypto.randomUUID(),
      ...validateTrajectory(input, this.tenantId),
      recordedAt: this.clock(),
    };
    this.trajectory.push(clone(record));
    return clone(record);
  }

  getTrajectory(eventId) {
    const id = requiredString(eventId, 'eventId', 128);
    return clone(this.trajectory.find((item) => item.id === id && item.tenantId === this.tenantId) || null);
  }

  evaluate(eventId, input, evaluator = {}) {
    const event = this.getTrajectory(eventId);
    if (!event) return null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('trajectory evaluation must be an object.');
    const label = requiredString(input.label, 'label', 80);
    if (!EVALUATION_LABELS.includes(label)) throw new Error('evaluation label is unsupported.');
    const evaluatorType = requiredString(evaluator.type, 'evaluator.type', 40);
    if (!['human', 'deterministic_eval', 'model_eval'].includes(evaluatorType)) throw new Error('evaluator.type is unsupported.');
    let evaluatorId;
    if (evaluatorType === 'human') {
      const actor = requireHumanEvaluator(evaluator.actor, this.tenantId);
      evaluatorId = actor.principalId;
    } else {
      evaluatorId = requiredString(evaluator.id, 'evaluator.id', 240);
    }
    const record = {
      id: crypto.randomUUID(),
      tenantId: this.tenantId,
      trajectoryEventId: event.id,
      label,
      reasonCodes: stringList(input.reasonCodes, 'reasonCodes', { min: 1, max: 50 }),
      evaluatorId,
      evaluatorType,
      evaluatorVersion: requiredString(evaluator.version, 'evaluator.version', 120),
      createdAt: this.clock(),
    };
    this.evaluations.push(clone(record));
    return clone(record);
  }

  correct(eventId, input, actorInput) {
    const event = this.getTrajectory(eventId);
    if (!event) return null;
    const actor = requireCorrectionAuthority(actorInput, this.tenantId);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('trajectory correction must be an object.');
    const correctionType = requiredString(input.correctionType, 'correctionType', 80);
    if (!CORRECTION_TYPES.includes(correctionType)) throw new Error('correctionType is unsupported.');
    const record = {
      id: crypto.randomUUID(),
      tenantId: this.tenantId,
      trajectoryEventId: event.id,
      correctedEntityId: requiredString(input.correctedEntityId, 'correctedEntityId', 240),
      correctionType,
      reasonCodes: stringList(input.reasonCodes, 'reasonCodes', { min: 1, max: 50 }),
      correctionSummary: requiredString(input.correctionSummary, 'correctionSummary', 5000),
      correctedBy: actor.principalId,
      correctedAt: this.clock(),
    };
    this.corrections.push(clone(record));
    return clone(record);
  }

  proposeCandidate(input, actorInput) {
    const actor = sameTenant(actorInput, this.tenantId);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('learning candidate must be an object.');
    const targetType = requiredString(input.targetType, 'targetType', 80);
    if (!CANDIDATE_TARGETS.includes(targetType)) throw new Error('learning candidate targetType is unsupported.');
    const evaluationIds = stringList(input.evaluationIds || [], 'evaluationIds', { max: 200 });
    const correctionIds = stringList(input.correctionIds || [], 'correctionIds', { max: 200 });
    if (evaluationIds.length + correctionIds.length === 0) {
      throw new Error('learning candidate requires at least one evaluation or correction record.');
    }
    for (const id of evaluationIds) {
      if (!this.evaluations.some((item) => item.id === id && item.tenantId === this.tenantId)) {
        throw new Error(`learning candidate references unknown evaluation ${id}.`);
      }
    }
    for (const id of correctionIds) {
      if (!this.corrections.some((item) => item.id === id && item.tenantId === this.tenantId)) {
        throw new Error(`learning candidate references unknown correction ${id}.`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(input, 'executableContent') || Object.prototype.hasOwnProperty.call(input, 'patch')) {
      throw new Error('learning candidates store reviewed references and rationale, not executable content or patches.');
    }
    const record = {
      id: crypto.randomUUID(),
      tenantId: this.tenantId,
      targetType,
      targetId: requiredString(input.targetId, 'targetId', 240),
      summary: requiredString(input.summary, 'summary', 2000),
      rationale: requiredString(input.rationale, 'rationale', 5000),
      artifactRef: requiredString(input.artifactRef, 'artifactRef', 1000),
      evaluationIds,
      correctionIds,
      evidenceEntityIds: stringList(input.evidenceEntityIds || [], 'evidenceEntityIds', { max: 200 }),
      status: 'proposed',
      proposedBy: actor.principalId,
      proposedByActorType: actor.actorType,
      proposedAt: this.clock(),
      automaticApplicationAllowed: false,
    };
    this.candidates.push(clone(record));
    return clone(record);
  }

  reviewCandidate(candidateId, decision, actorInput, options = {}) {
    const actor = requireCandidateReviewer(actorInput, this.tenantId);
    const candidate = this.candidates.find((item) => item.id === candidateId && item.tenantId === this.tenantId);
    if (!candidate) return null;
    if (!['approve', 'reject'].includes(decision)) throw new Error('candidate review decision must be approve or reject.');
    if (this.candidateReviews.some((item) => item.candidateId === candidate.id)) {
      const error = new Error('Learning candidate has already been reviewed.');
      error.code = 'REVIEW_CONFLICT';
      throw error;
    }
    const record = {
      id: crypto.randomUUID(),
      tenantId: this.tenantId,
      candidateId: candidate.id,
      decision,
      status: decision === 'approve' ? 'approved_candidate' : 'rejected_candidate',
      rationale: requiredString(options.rationale, 'review rationale', 5000),
      reviewedBy: actor.principalId,
      reviewedAt: this.clock(),
      automaticApplicationAllowed: false,
      applicationState: 'not_applied',
    };
    this.candidateReviews.push(clone(record));
    return clone(record);
  }

  query(input = {}) {
    const runId = optionalString(input.runId, 'runId', 240);
    const stage = optionalString(input.stage, 'stage', 80);
    const candidateStatus = optionalString(input.candidateStatus, 'candidateStatus', 80);
    const trajectory = this.trajectory.filter((item) => (!runId || item.runId === runId) && (!stage || item.stage === stage)).map(clone);
    const candidates = this.candidates.map((candidate) => {
      const review = this.candidateReviews.find((item) => item.candidateId === candidate.id) || null;
      return { ...clone(candidate), review: clone(review) };
    }).filter((item) => !candidateStatus || (item.review?.status || item.status) === candidateStatus);
    return {
      tenantId: this.tenantId,
      trajectory,
      evaluations: this.evaluations.filter((item) => trajectory.some((event) => event.id === item.trajectoryEventId)).map(clone),
      corrections: this.corrections.filter((item) => trajectory.some((event) => event.id === item.trajectoryEventId)).map(clone),
      candidates,
      automaticProductionModification: false,
    };
  }
}

module.exports = {
  CANDIDATE_TARGETS,
  CORRECTION_TYPES,
  EVALUATION_LABELS,
  InMemoryLearningMemory,
  OUTCOME_CLASSES,
  TRAJECTORY_STAGES,
  validateTrajectory,
};
