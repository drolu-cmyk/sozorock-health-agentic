const { EvidenceGatewayClient } = require('../adapters/evidence-gateway-client');
const { createCBCAPGraph } = require('../runtime/cbcap-graph');
const {
  buildBarrierProfile,
  buildPlanningBrief,
  buildPlanningWorkspace,
} = require('./evidence-planning');

const COUNTY_FIPS = /^\d{5}$/;
const DEFAULT_EVIDENCE_ORIGIN = 'https://health.sozorockfoundation.org';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizeRequest(input) {
  const source = typeof input === 'string' ? { countyFips: input } : (input || {});
  const countyFips = String(source.countyFips || source.location || '').trim();
  return {
    countyFips,
    assumptions: clone(source.assumptions),
    approval: clone(source.approval),
  };
}

class CBCAPPlanningEngine {
  constructor(options = {}) {
    this.auditSink = options.auditSink || (() => {});
    this.tenantId = typeof options.tenantId === 'string' && options.tenantId.trim() ? options.tenantId.trim() : null;
    this.evidenceClient = options.evidenceClient || new EvidenceGatewayClient({
      baseUrl: options.evidenceOrigin || process.env.EVIDENCE_GATEWAY_ORIGIN || DEFAULT_EVIDENCE_ORIGIN,
      fetchImpl: options.fetchImpl,
    });
    this.scenarioHandler = typeof options.scenarioHandler === 'function' ? options.scenarioHandler : null;
    this.publishHandler = typeof options.publishHandler === 'function' ? options.publishHandler : null;

    const handlers = {
      resolvePlace: async (task) => ({ countyFips: task.countyFips }),
      loadEvidence: async (place) => this.evidenceClient.getCountyPackage(place.countyFips),
      synthesizeBarriers: async (evidence) => buildBarrierProfile(evidence),
      organizePlan: async (state) => buildPlanningWorkspace(state.evidence, state.barriers),
      draftBrief: async (state) => buildPlanningBrief(state),
    };

    if (this.scenarioHandler) {
      handlers.buildScenario = async (state, assumptions) => {
        const output = await this.scenarioHandler(clone(state), clone(assumptions));
        if (!output || typeof output !== 'object' || Array.isArray(output)) {
          throw new Error('Scenario handler must return a structured scenario output.');
        }
        if (output.status !== 'scenario_output') {
          throw new Error('Scenario handler must label its result as scenario_output.');
        }
        return clone(output);
      };
    }

    if (this.publishHandler) {
      handlers.publish = async (state) => this.publishHandler(clone(state));
    }

    this.graph = createCBCAPGraph({
      handlers,
      memory: options.memory,
      harness: options.harness,
      killSwitch: options.killSwitch,
      clock: options.clock,
    });
  }

  _formatState(state) {
    return {
      type: 'cbcap_county_plan',
      ...state,
      meta: {
        engine: 'cbcap-governed-planning-v3',
        evidenceAuthority: 'sozorock-evidence-gateway',
        distinctFrom: 'place-intelligence-front-door',
        syntheticPlanningOutputs: false,
        humanReviewRequired: state.status !== 'approved_output',
        resumableReview: state.status === 'awaiting_human_review' && Boolean(this.publishHandler),
      },
    };
  }

  async buildCountyPlan(input) {
    const request = normalizeRequest(input);
    if (!COUNTY_FIPS.test(request.countyFips)) {
      const result = {
        type: 'cbcap_county_plan',
        status: 'error',
        error: {
          code: 'county_fips_required',
          reason: 'Governed CB-CAP planning requires an exact five-digit county FIPS. Resolve names, places, and ZIP-linked inputs before calling the planning engine.',
        },
        meta: {
          engine: 'cbcap-governed-planning-v3',
          evidenceAuthority: 'sozorock-evidence-gateway',
          syntheticPlanningOutputs: false,
          resumableReview: false,
        },
      };
      this.auditSink({ action: 'cbcap_request_rejected', code: result.error.code });
      return result;
    }

    const task = {
      type: 'county_plan',
      countyFips: request.countyFips,
    };
    if (request.assumptions !== undefined) task.assumptions = request.assumptions;

    const initial = {};
    if (this.tenantId) initial.tenantId = this.tenantId;
    if (request.approval !== undefined) initial.approval = request.approval;

    const state = await this.graph.run(task, initial);
    this.auditSink({
      action: state.status === 'awaiting_human_review' ? 'cbcap_draft_created' : 'cbcap_graph_completed',
      fips: request.countyFips,
      status: state.status,
      runId: state.runId,
      releaseId: state.evidence?.releaseId || null,
      tenantId: this.tenantId,
    });

    return this._formatState(state);
  }

  async getRunReviewCheckpoint(runId) {
    if (typeof runId !== 'string' || !runId.trim()) throw new Error('runId is required.');
    if (!this.graph.memory || typeof this.graph.memory.latestCheckpoint !== 'function') {
      throw new Error('Configured graph memory does not expose review checkpoints.');
    }
    const checkpoint = await this.graph.memory.latestCheckpoint(runId.trim());
    if (!checkpoint) return null;
    const state = checkpoint.state || {};
    return {
      runId: state.runId || runId.trim(),
      tenantId: state.tenantId || null,
      status: checkpoint.status || state.status || null,
      resumeAt: checkpoint.resumeAt || null,
      evidenceReleaseId: state.evidence?.releaseId || null,
      countyFips: state.evidence?.countyFips || state.place?.countyFips || state.task?.countyFips || null,
      draft: clone(state.draft || null),
      checkpointSequence: checkpoint.sequence,
    };
  }

  async resumeCountyPlan(runId, approval) {
    if (!this.publishHandler) {
      throw new Error('No reviewed publish capability is installed for CB-CAP review continuation.');
    }
    const state = await this.graph.resume(runId, { approval: clone(approval) });
    this.auditSink({
      action: 'cbcap_review_continued',
      fips: state.evidence?.countyFips || state.place?.countyFips || null,
      status: state.status,
      runId: state.runId,
      releaseId: state.evidence?.releaseId || null,
      tenantId: this.tenantId,
    });
    return this._formatState(state);
  }
}

module.exports = {
  CBCAPPlanningEngine,
  DEFAULT_EVIDENCE_ORIGIN,
  normalizeRequest,
};
