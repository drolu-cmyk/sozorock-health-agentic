const {
  approvalMatchesState,
  hasUserAssumptions,
  validateEvidenceEnvelope,
} = require('./contracts');

class GovernedHarness {
  constructor(options = {}) {
    this.maxSteps = options.maxSteps || 24;
    this.killSwitch = options.killSwitch || (() => false);
    this.allowedNodes = options.allowedNodes ? new Set(options.allowedNodes) : null;
  }

  authorize({ nodeId, state, step }) {
    if (this.killSwitch()) {
      return { ok: false, code: 'kill_switch', reason: 'Agent execution is disabled by the runtime kill switch.' };
    }
    if (step > this.maxSteps) {
      return { ok: false, code: 'step_budget', reason: `Agent graph exceeded the ${this.maxSteps}-step budget.` };
    }
    if (this.allowedNodes && !this.allowedNodes.has(nodeId)) {
      return { ok: false, code: 'node_not_allowed', reason: `Node ${nodeId} is not authorized by this harness.` };
    }
    if (nodeId === 'scenario' && !hasUserAssumptions(state.task?.assumptions)) {
      return { ok: false, code: 'assumptions_required', reason: 'Scenario execution requires explicit user assumptions.' };
    }
    if (nodeId === 'publish' && !approvalMatchesState(state.approval, state)) {
      return {
        ok: false,
        code: 'human_approval_required',
        reason: 'Publishing requires a human approval bound to this graph run and Evidence Gateway release.',
      };
    }
    return { ok: true };
  }

  validateAfter({ nodeId, state }) {
    if (nodeId === 'load_evidence') {
      validateEvidenceEnvelope(state.evidence, state.place?.countyFips || null);
    }
    if (state.output?.clinicalDecision === true) {
      return { ok: false, code: 'clinical_boundary', reason: 'Clinical decision output is outside the CB-CAP boundary.' };
    }
    return { ok: true };
  }
}

module.exports = { GovernedHarness };
