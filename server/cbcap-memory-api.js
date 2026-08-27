const { permissionDecision, validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

function forbidden() {
  return { statusCode: 403, body: { error: 'Institutional memory authorization failed.' } };
}

function conflict(message) {
  return { statusCode: 409, body: { error: message } };
}

function createCBCAPMemoryApi(options = {}) {
  if (!options.workspaceMemory || typeof options.workspaceMemory.list !== 'function') {
    throw new Error('Memory API requires workspaceMemory.');
  }
  if (!options.institutionalMemory || typeof options.institutionalMemory.queryMemory !== 'function' && typeof options.institutionalMemory.query !== 'function') {
    throw new Error('Memory API requires institutionalMemory.');
  }
  const workspaceMemory = options.workspaceMemory;
  const institutionalMemory = options.institutionalMemory;
  const evidenceValidator = typeof options.evidenceValidator === 'function' ? options.evidenceValidator : null;
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};

  function actor(context, action) {
    let value;
    try { value = validateWorkspaceActor(context?.workspaceActor); } catch { return null; }
    const decision = permissionDecision(value, action);
    return decision.ok ? decision.actor : null;
  }

  async function validateEvidence(workspaceActor, evidenceEntityIds, context = {}) {
    if (!evidenceValidator) return { ok: false, unavailable: true, missing: [] };
    try {
      const result = await evidenceValidator(workspaceActor, evidenceEntityIds, context);
      const missing = Array.isArray(result?.missingIds) ? result.missingIds : [];
      return { ok: result?.ok === true && missing.length === 0, unavailable: false, missing };
    } catch {
      return { ok: false, unavailable: true, missing: [] };
    }
  }

  const queryInstitutional = async (input, context) => {
    const workspaceActor = actor(context, 'cbcap.memory.read');
    if (!workspaceActor) return forbidden();
    const requested = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
    const wantsPrivileged = requested.includeProposed === true || requested.includeRejected === true || requested.includeExpired === true;
    if (wantsPrivileged && !permissionDecision(workspaceActor, 'cbcap.memory.review').ok) return forbidden();
    try {
      const query = typeof institutionalMemory.queryMemory === 'function'
        ? institutionalMemory.queryMemory.bind(institutionalMemory)
        : institutionalMemory.query.bind(institutionalMemory);
      const records = await query(requested);
      return { statusCode: 200, body: { records } };
    } catch {
      return { statusCode: 400, body: { error: 'Institutional memory query is invalid.' } };
    }
  };

  return {
    async listWorkspace(workspaceId, input, context) {
      const workspaceActor = actor(context, 'cbcap.workspace.read');
      if (!workspaceActor) return forbidden();
      try {
        const items = await workspaceMemory.list(workspaceId, { status: input?.status || null });
        return { statusCode: 200, body: { workspaceId, items } };
      } catch {
        return { statusCode: 400, body: { error: 'Workspace query is invalid.' } };
      }
    },

    async createWorkspace(input, context) {
      const workspaceActor = actor(context, 'cbcap.workspace.write');
      if (!workspaceActor) return forbidden();
      try {
        const item = await workspaceMemory.create(input, workspaceActor);
        auditSink({ action: 'cbcap_workspace_item_created', tenantId: workspaceActor.tenantId, principalId: workspaceActor.principalId, workspaceId: item.workspaceId, itemId: item.id, itemType: item.itemType });
        return { statusCode: 201, body: item };
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }
    },

    async updateWorkspace(workspaceId, itemId, input, context) {
      const workspaceActor = actor(context, 'cbcap.workspace.write');
      if (!workspaceActor) return forbidden();
      if (!input || typeof input !== 'object' || Array.isArray(input) || !Number.isInteger(input.expectedVersion)) {
        return { statusCode: 400, body: { error: 'expectedVersion and patch are required.' } };
      }
      try {
        const item = await workspaceMemory.update(workspaceId, itemId, input.patch || {}, input.expectedVersion, workspaceActor);
        if (!item) return { statusCode: 404, body: { error: 'Workspace item not found.' } };
        auditSink({ action: 'cbcap_workspace_item_updated', tenantId: workspaceActor.tenantId, principalId: workspaceActor.principalId, workspaceId, itemId, version: item.version });
        return { statusCode: 200, body: item };
      } catch (error) {
        if (error.code === 'VERSION_CONFLICT') return conflict('Workspace item version conflict. Refresh before editing again.');
        return { statusCode: 400, body: { error: error.message } };
      }
    },

    queryInstitutional,

    async proposeInstitutional(input, context) {
      const workspaceActor = actor(context, 'cbcap.memory.propose');
      if (!workspaceActor) return forbidden();
      const ids = Array.isArray(input?.evidenceEntityIds) ? input.evidenceEntityIds : [];
      const validation = await validateEvidence(workspaceActor, ids, { geographyId: input?.geographyId || null });
      if (validation.unavailable) return { statusCode: 503, body: { error: 'Institutional evidence validation is unavailable.' } };
      if (!validation.ok) return { statusCode: 422, body: { error: 'Institutional memory evidence is not fully verified.', missingEvidenceIds: validation.missing } };
      try {
        const record = await institutionalMemory.propose(input, workspaceActor);
        auditSink({ action: 'cbcap_institutional_memory_proposed', tenantId: workspaceActor.tenantId, principalId: workspaceActor.principalId, memoryId: record.id, subjectId: record.subjectId });
        return { statusCode: 201, body: record };
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }
    },

    async reviewInstitutional(proposalId, input, context) {
      const workspaceActor = actor(context, 'cbcap.memory.review');
      if (!workspaceActor) return forbidden();
      if (!input || !['approve','reject'].includes(input.decision) || typeof input.rationale !== 'string') {
        return { statusCode: 400, body: { error: 'decision and rationale are required.' } };
      }
      const proposal = await institutionalMemory.get(proposalId);
      if (!proposal || proposal.status !== 'proposed') return { statusCode: 404, body: { error: 'Institutional memory proposal not found.' } };
      if (input.decision === 'approve') {
        const validation = await validateEvidence(workspaceActor, proposal.evidenceEntityIds, { geographyId: proposal.geographyId });
        if (validation.unavailable) return { statusCode: 503, body: { error: 'Institutional evidence validation is unavailable.' } };
        if (!validation.ok) return { statusCode: 422, body: { error: 'Institutional memory evidence is no longer fully verified.', missingEvidenceIds: validation.missing } };
      }
      try {
        const record = await institutionalMemory.review(proposalId, input.decision, workspaceActor, { rationale: input.rationale });
        if (!record) return { statusCode: 404, body: { error: 'Institutional memory proposal not found.' } };
        auditSink({ action: 'cbcap_institutional_memory_reviewed', tenantId: workspaceActor.tenantId, principalId: workspaceActor.principalId, memoryId: record.id, sourceProposalId: proposalId, decision: input.decision });
        return { statusCode: 200, body: record };
      } catch (error) {
        if (error.code === 'REVIEW_CONFLICT') return conflict(error.message);
        return { statusCode: 400, body: { error: error.message } };
      }
    },

    async supersedeInstitutional(memoryId, input, context) {
      const workspaceActor = actor(context, 'cbcap.memory.review');
      if (!workspaceActor) return forbidden();
      try {
        const record = await institutionalMemory.supersede(memoryId, workspaceActor, input || {});
        if (!record) return { statusCode: 404, body: { error: 'Reviewed institutional memory not found.' } };
        auditSink({ action: 'cbcap_institutional_memory_superseded', tenantId: workspaceActor.tenantId, principalId: workspaceActor.principalId, memoryId, supersessionId: record.id });
        return { statusCode: 200, body: record };
      } catch (error) {
        if (error.code === 'SUPERSESSION_CONFLICT') return conflict(error.message);
        return { statusCode: 400, body: { error: error.message } };
      }
    },
  };
}

module.exports = { createCBCAPMemoryApi };
