const crypto = require('crypto');
const { validateProposal } = require('./institutional-memory');

function requiredString(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function parseJson(value, fallback = []) {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function mapRow(row) {
  if (!row) return null;
  const iso = (value) => value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : String(value);
  return {
    id: String(row.id), tenantId: row.tenant_id, geographyId: row.geography_id,
    decisionType: row.decision_type, subjectType: row.subject_type, subjectId: row.subject_id,
    outcome: row.outcome, reasonCodes: parseJson(row.reason_codes), rationale: row.rationale,
    evidenceEntityIds: parseJson(row.evidence_entity_ids), relatedEntityIds: parseJson(row.related_entity_ids),
    missingRequirements: parseJson(row.missing_requirements), status: row.status, applicability: row.applicability,
    proposedBy: row.proposed_by, proposedAt: iso(row.proposed_at), reviewedBy: row.reviewed_by,
    reviewedAt: iso(row.reviewed_at), reviewDecision: row.review_decision, reviewRationale: row.review_rationale,
    sourceProposalId: row.source_proposal_id ? String(row.source_proposal_id) : null,
    supersedesMemoryId: row.supersedes_memory_id ? String(row.supersedes_memory_id) : null,
    expiresAt: iso(row.expires_at),
  };
}

class SqlInstitutionalMemory {
  constructor(options = {}) {
    if (typeof options.query !== 'function') throw new Error('SqlInstitutionalMemory requires query(sql, params).');
    this.query = options.query;
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
    this.clock = options.clock || (() => new Date().toISOString());
  }

  async propose(input, actor) {
    const proposal = validateProposal(input, { tenantId: this.tenantId });
    const id = crypto.randomUUID();
    const now = this.clock();
    const sql = `INSERT INTO cbcap_institutional_memory
      (id,tenant_id,geography_id,decision_type,subject_type,subject_id,outcome,reason_codes,rationale,
       evidence_entity_ids,related_entity_ids,missing_requirements,status,applicability,proposed_by,proposed_at,expires_at)
      VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12::jsonb,'proposed',$13,$14,$15::timestamptz,$16::timestamptz)
      RETURNING *`;
    const result = await this.query(sql, [id,this.tenantId,proposal.geographyId,proposal.decisionType,proposal.subjectType,proposal.subjectId,proposal.outcome,JSON.stringify(proposal.reasonCodes),proposal.rationale,JSON.stringify(proposal.evidenceEntityIds),JSON.stringify(proposal.relatedEntityIds),JSON.stringify(proposal.missingRequirements),proposal.applicability,actor.principalId,now,proposal.expiresAt]);
    return mapRow(result.rows[0]);
  }

  async review(proposalId, decision, actor, options = {}) {
    if (!['approve','reject'].includes(decision)) throw new Error('review decision must be approve or reject.');
    const now = this.clock();
    const id = crypto.randomUUID();
    const rationale = requiredString(options.rationale, 'review rationale', 5000);
    const sql = `INSERT INTO cbcap_institutional_memory
      (id,tenant_id,geography_id,decision_type,subject_type,subject_id,outcome,reason_codes,rationale,
       evidence_entity_ids,related_entity_ids,missing_requirements,status,applicability,proposed_by,proposed_at,
       reviewed_by,reviewed_at,review_decision,review_rationale,source_proposal_id,expires_at)
      SELECT $1::uuid, tenant_id, geography_id, decision_type, subject_type, subject_id, outcome, reason_codes, rationale,
             evidence_entity_ids, related_entity_ids, missing_requirements,
             CASE WHEN $4='approve' THEN 'reviewed' ELSE 'rejected' END,
             applicability, proposed_by, proposed_at, $5, $6::timestamptz, $4, $7, id, expires_at
        FROM cbcap_institutional_memory
       WHERE tenant_id=$2 AND id=$3::uuid AND status='proposed'
      RETURNING *`;
    try {
      const result = await this.query(sql, [id,this.tenantId,requiredString(proposalId,'proposalId',128),decision,actor.principalId,now,rationale]);
      return result?.rows?.length ? mapRow(result.rows[0]) : null;
    } catch (error) {
      if (String(error?.code) === '23505') {
        const conflict = new Error('Institutional memory proposal has already been reviewed.');
        conflict.code = 'REVIEW_CONFLICT';
        throw conflict;
      }
      throw error;
    }
  }

  async supersede(memoryId, actor, input = {}) {
    const id = crypto.randomUUID();
    const now = this.clock();
    const reasonCodes = Array.isArray(input.reasonCodes) ? [...new Set(input.reasonCodes.map((item) => requiredString(item,'reasonCode',500)))] : [];
    if (!reasonCodes.length) throw new Error('reasonCodes must contain at least one item.');
    const rationale = requiredString(input.rationale, 'rationale', 5000);
    const sql = `INSERT INTO cbcap_institutional_memory
      (id,tenant_id,geography_id,decision_type,subject_type,subject_id,outcome,reason_codes,rationale,
       evidence_entity_ids,related_entity_ids,missing_requirements,status,applicability,proposed_by,proposed_at,
       reviewed_by,reviewed_at,review_decision,review_rationale,supersedes_memory_id,expires_at)
      SELECT $1::uuid, tenant_id, geography_id, decision_type, subject_type, subject_id, 'superseded', $4::jsonb, $5,
             evidence_entity_ids, related_entity_ids, missing_requirements, 'superseded', 'expired', proposed_by, proposed_at,
             $6, $7::timestamptz, 'supersede', $5, id, $7::timestamptz
        FROM cbcap_institutional_memory
       WHERE tenant_id=$2 AND id=$3::uuid AND status='reviewed'
      RETURNING *`;
    try {
      const result = await this.query(sql, [id,this.tenantId,requiredString(memoryId,'memoryId',128),JSON.stringify(reasonCodes),rationale,actor.principalId,now]);
      return result?.rows?.length ? mapRow(result.rows[0]) : null;
    } catch (error) {
      if (String(error?.code) === '23505') {
        const conflict = new Error('Institutional memory has already been superseded.');
        conflict.code = 'SUPERSESSION_CONFLICT';
        throw conflict;
      }
      throw error;
    }
  }

  async queryMemory(options = {}) {
    const asOf = options.asOf || this.clock();
    if (!Number.isFinite(Date.parse(asOf))) throw new Error('asOf must be an ISO-compatible timestamp.');
    const geographyId = options.geographyId || null;
    const decisionType = options.decisionType || null;
    const subjectId = options.subjectId || null;
    const includeProposed = options.includeProposed === true;
    const includeRejected = options.includeRejected === true;
    const includeExpired = options.includeExpired === true;
    const sql = `SELECT memory.*
      FROM cbcap_institutional_memory memory
     WHERE memory.tenant_id=$1
       AND ($2::text IS NULL OR memory.geography_id=$2)
       AND ($3::text IS NULL OR memory.decision_type=$3)
       AND ($4::text IS NULL OR memory.subject_id=$4)
       AND (
         memory.status='reviewed'
         OR ($5::boolean AND memory.status='proposed')
         OR ($6::boolean AND memory.status='rejected')
         OR ($7::boolean AND memory.status='superseded')
       )
       AND ($7::boolean OR memory.expires_at IS NULL OR memory.expires_at > $8::timestamptz)
       AND ($7::boolean OR NOT EXISTS (
         SELECT 1 FROM cbcap_institutional_memory superseding
          WHERE superseding.tenant_id=memory.tenant_id
            AND superseding.supersedes_memory_id=memory.id
            AND superseding.status='superseded'
       ))
     ORDER BY COALESCE(memory.reviewed_at,memory.proposed_at) DESC, memory.id`;
    const result = await this.query(sql,[this.tenantId,geographyId,decisionType,subjectId,includeProposed,includeRejected,includeExpired,asOf]);
    return (result?.rows || []).map(mapRow);
  }
}

module.exports = { SqlInstitutionalMemory, mapRow };
