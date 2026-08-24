const { GeographyAgent } = require('../agents/sub-agents/geography-agent');
const { EvidenceGatewayClient } = require('../adapters/evidence-gateway-client');
const { createCBCAPGraph } = require('../runtime/cbcap-graph');
const {
  hasUserAssumptions,
  isApprovedHumanRecord,
} = require('../runtime/contracts');

const BARRIER_MEASURES = Object.freeze({
  ACCESS2: 'insurance_access',
  LACKTRPT: 'transportation',
  FOODINSECU: 'food_access',
  HOUSINSECU: 'housing_stability',
  SHUTUTILITY: 'utility_stability',
  LONELINESS: 'social_connection',
  DISABILITY: 'disability_context',
});

function sourceMeasureCode(measure) {
  const raw = measure?.semantics?.source_measure_id || measure?.semantics?.sourceMeasureId || '';
  return String(raw).trim().toUpperCase().split(':')[0];
}

function measureSummary(measure, domain) {
  const semantics = measure.semantics || {};
  return {
    domain,
    evidenceState: 'published_public_estimate',
    measureId: semantics.id || measure.id,
    sourceMeasureId: semantics.source_measure_id || null,
    name: semantics.name || 'Published measure',
    description: semantics.description || null,
    direction: semantics.direction || null,
    higherValueMeaning: semantics.higher_value_meaning || null,
    unit: semantics.unit || null,
    value: measure.value,
    numericValue: measure.numeric_value,
    confidence: {
      low: measure.confidence_low ?? null,
      high: measure.confidence_high ?? null,
      marginOfError: measure.margin_of_error ?? null,
    },
    dataPeriod: {
      start: measure.data_period_start ?? null,
      end: measure.data_period_end ?? null,
    },
    reviewStatus: measure.review_status || null,
    sourceVersionId: measure.source_version?.source_version_id || null,
  };
}

function validateAssumptions(assumptions) {
  if (assumptions === undefined || assumptions === null) return null;
  if (!hasUserAssumptions(assumptions)) {
    throw new Error('assumptions must be a non-empty object whose entries are explicitly marked source=user.');
  }
  const entries = Object.entries(assumptions);
  if (entries.length > 20) throw new Error('assumptions may contain at most 20 entries.');
  for (const [key, entry] of entries) {
    if (key.length > 64) throw new Error('assumption keys must be 64 characters or fewer.');
    const value = entry.value;
    const type = typeof value;
    if (value !== null && !['string', 'number', 'boolean'].includes(type)) {
      throw new Error(`assumption ${key} must contain a scalar value.`);
    }
    if (type === 'number' && !Number.isFinite(value)) {
      throw new Error(`assumption ${key} must contain a finite number.`);
    }
  }
  return structuredClone(assumptions);
}

function readNumericAssumption(assumptions, key, predicate) {
  const value = assumptions?.[key]?.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) return null;
  return value;
}

function createHandlers({ geographyAgent, evidenceClient }) {
  return {
    async resolvePlace(task) {
      const resolved = await geographyAgent.resolve(task.location);
      if (!resolved) return { status: 'unresolved', query: task.location };
      if (resolved.status === 'ambiguous') {
        return {
          status: 'ambiguous',
          message: resolved.message,
          query: task.location,
          matches: resolved.matches || [],
        };
      }
      if (resolved.multiCounty) {
        return {
          status: 'ambiguous',
          kind: 'multi_county_zip',
          query: task.location,
          message: 'This ZIP-linked input overlaps more than one county. Select one county explicitly before CB-CAP planning continues.',
          matches: (resolved.allCounties || []).map((county) => ({
            countyFips: county.fips,
            name: county.name || null,
            residentialShare: county.resRatio ?? null,
          })),
        };
      }
      return {
        status: 'resolved',
        countyFips: resolved.fips,
        name: [resolved.county, resolved.state].filter(Boolean).join(', '),
        state: resolved.state || null,
        resolvedAs: resolved.resolvedAs || null,
        input: task.location,
      };
    },

    async loadEvidence(place) {
      return evidenceClient.getCountyPackage(place.countyFips);
    },

    async synthesizeBarriers(evidence) {
      const measures = Array.isArray(evidence.measures) ? evidence.measures : [];
      const findings = [];
      for (const measure of measures) {
        const domain = BARRIER_MEASURES[sourceMeasureCode(measure)];
        if (!domain) continue;
        findings.push(measureSummary(measure, domain));
      }
      return {
        status: findings.length ? 'published_barrier_evidence' : 'no_verified_barrier_measures',
        evidenceState: 'published_public_estimate',
        method: 'reviewed_cdc_places_barrier_allowlist_v1',
        findings,
        unclassifiedMeasureCount: Math.max(0, measures.length - findings.length),
        limitations: [
          'CB-CAP does not convert health-condition estimates into barrier scores.',
          'A published population estimate is not proof of a local priority or a causal explanation.',
          'Missing or unavailable measures are preserved as missing and never converted to zero.',
        ],
      };
    },

    async organizePlan(state) {
      const coverage = Array.isArray(state.evidence?.sourceCoverage) ? state.evidence.sourceCoverage : [];
      const gaps = coverage
        .filter((item) => item.status !== 'complete_with_records')
        .map((item) => ({
          sourceId: item.source_id || null,
          status: item.status || 'unavailable',
          caveat: item.caveat || null,
          recordsMatched: item.records_matched ?? null,
        }));
      const reviewQuestions = (state.barriers?.findings || []).slice(0, 5).map((finding) => ({
        domain: finding.domain,
        question: `Does current local evidence confirm ${finding.name.toLowerCase()} as a practical barrier that should enter county planning?`,
        evidenceState: 'derived_planning_view',
        supportingMeasureId: finding.measureId,
      }));
      return {
        evidenceState: 'derived_planning_view',
        localPriorityStatus: 'not_established',
        responseRecommendationStatus: 'not_established',
        reviewQuestions,
        evidenceGaps: gaps,
        decisionBoundary: {
          canOrganizeQuestions: true,
          canDeclareCountyPriority: false,
          canRecommendResponse: false,
          reason: 'Published population estimates must be tested against verified local planning evidence, assets, constraints, and community review.',
        },
      };
    },

    async buildScenario(_state, assumptions) {
      const reachablePopulation = readNumericAssumption(assumptions, 'reachablePopulation', (value) => value >= 0);
      const uptakeRate = readNumericAssumption(assumptions, 'uptakeRate', (value) => value >= 0 && value <= 1);
      const months = readNumericAssumption(assumptions, 'months', (value) => value > 0 && value <= 60);
      const outputs = [];
      if (reachablePopulation !== null && uptakeRate !== null) {
        outputs.push({
          id: 'modeled_engagement_count',
          evidenceState: 'scenario_output',
          value: Math.round(reachablePopulation * uptakeRate),
          formula: 'reachablePopulation × uptakeRate',
          inputs: ['reachablePopulation', 'uptakeRate'],
          unit: 'people',
        });
      }
      return {
        status: 'scenario_output',
        evidenceState: 'scenario_output',
        assumptions: structuredClone(assumptions),
        durationMonths: months,
        outputs,
        limitations: [
          'Scenario outputs are arithmetic planning views based only on user assumptions.',
          'They are not forecasts, measured impact, funding determinations, or clinical demand predictions.',
          'No barrier-reduction effect or cost-effectiveness claim is inferred.',
        ],
      };
    },

    async draftBrief(state) {
      return {
        status: 'draft_for_review',
        evidenceState: 'derived_planning_view',
        title: `CB-CAP planning brief: ${state.place.name}`,
        promise: 'See the pattern. Test a response. Build a fundable plan.',
        place: structuredClone(state.place),
        evidenceRelease: {
          contract: state.evidence.contract,
          releaseId: state.evidence.releaseId,
          releaseHash: state.evidence.releaseHash,
        },
        barrierEvidence: structuredClone(state.barriers),
        planning: structuredClone(state.planning),
        scenario: state.scenario ? structuredClone(state.scenario) : null,
        reviewRequired: true,
        publicationBoundary: 'This draft is not an official county priority, CHA/CHIP decision, funding determination, or public claim until reviewed and approved by an authorized person.',
      };
    },

    async publish(state) {
      return {
        status: 'approved_output',
        evidenceState: 'derived_planning_view',
        approvedBy: state.approval.by,
        reviewedAt: state.approval.reviewedAt,
        scope: state.approval.scope,
        externalPublicationExecuted: false,
        brief: structuredClone(state.draft),
      };
    },
  };
}

function createCBCAPService(options = {}) {
  const geographyAgent = options.geographyAgent || new GeographyAgent();
  const evidenceClient = options.evidenceClient || new EvidenceGatewayClient({
    baseUrl: options.evidenceGatewayOrigin || process.env.EVIDENCE_GATEWAY_ORIGIN || 'https://health.sozorockfoundation.org',
    fetchImpl: options.fetchImpl,
  });
  const handlers = createHandlers({ geographyAgent, evidenceClient });
  const graph = createCBCAPGraph({
    handlers,
    memory: options.memory,
    clock: options.clock,
    killSwitch: options.killSwitch || (() => process.env.CBCAP_AGENT_EXECUTION_DISABLED === 'true'),
  });

  return {
    async handle(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { statusCode: 400, body: { error: 'request body must be an object' } };
      }
      const location = typeof input.location === 'string' ? input.location.trim() : '';
      if (!location) return { statusCode: 400, body: { error: 'location is required' } };
      if (location.length > 120) return { statusCode: 400, body: { error: 'location is too long' } };

      let assumptions = null;
      try {
        assumptions = validateAssumptions(input.assumptions);
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }

      let approval = null;
      if (input.approval !== undefined && input.approval !== null) {
        if (!isApprovedHumanRecord(input.approval)) {
          return {
            statusCode: 400,
            body: { error: 'approval must include status=approved, reviewer identity, county_plan scope, and a valid reviewedAt timestamp' },
          };
        }
        approval = structuredClone(input.approval);
      }

      const task = { type: 'county_plan', location };
      if (assumptions) task.assumptions = assumptions;
      const result = await graph.run(task, approval ? { approval } : {});

      if (result.status === 'awaiting_human_review') return { statusCode: 202, body: result };
      if (result.status === 'needs_place_selection') return { statusCode: 409, body: result };
      if (result.status === 'approved_output') return { statusCode: 200, body: result };
      if (result.error?.code === 'node_error') {
        return {
          statusCode: 502,
          body: {
            status: 'evidence_unavailable',
            runId: result.runId,
            error: { code: 'evidence_unavailable', reason: 'The governed evidence source could not complete this request.' },
          },
        };
      }
      return { statusCode: 422, body: result };
    },
  };
}

module.exports = {
  BARRIER_MEASURES,
  createCBCAPService,
};
