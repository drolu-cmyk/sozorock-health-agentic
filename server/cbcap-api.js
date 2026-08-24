const { GeographyAgent } = require('../packages/agents/sub-agents/geography-agent');
const { CBCAPPlanningEngine } = require('../packages/cbcap/planning-engine');
const { hasUserAssumptions, isApprovedHumanRecord } = require('../packages/runtime/contracts');

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function validateAssumptions(assumptions) {
  if (assumptions === undefined || assumptions === null) return undefined;
  if (!hasUserAssumptions(assumptions)) {
    throw new Error('assumptions must be a non-empty object whose entries are explicitly marked source=user');
  }
  const entries = Object.entries(assumptions);
  if (entries.length > 20) throw new Error('assumptions may contain at most 20 entries');
  for (const [key, entry] of entries) {
    if (key.length > 64) throw new Error('assumption keys must be 64 characters or fewer');
    const value = entry.value;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`assumption ${key} must contain a scalar value`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`assumption ${key} must contain a finite number`);
    }
  }
  return clone(assumptions);
}

function geographyResponse(resolved, query) {
  if (!resolved) {
    return {
      status: 'needs_place_selection',
      error: {
        code: 'place_not_resolved',
        reason: 'The requested geography could not be resolved to one verified U.S. county.',
      },
      place: { status: 'unresolved', query },
    };
  }
  if (resolved.status === 'ambiguous') {
    return {
      status: 'needs_place_selection',
      error: {
        code: 'place_selection_required',
        reason: resolved.message || 'More than one county matches this request.',
      },
      place: {
        status: 'ambiguous',
        query,
        matches: clone(resolved.matches || []),
      },
    };
  }
  if (resolved.multiCounty) {
    return {
      status: 'needs_place_selection',
      error: {
        code: 'multi_county_selection_required',
        reason: 'This ZIP-linked input overlaps more than one county. Select one county explicitly before CB-CAP planning continues.',
      },
      place: {
        status: 'ambiguous',
        kind: 'multi_county_zip',
        query,
        matches: (resolved.allCounties || []).map((item) => ({
          countyFips: item.fips,
          county: item.name || null,
          residentialShare: item.resRatio ?? null,
        })),
      },
    };
  }
  return null;
}

function createCBCAPApi(options = {}) {
  const geographyAgent = options.geographyAgent || new GeographyAgent();
  const engine = options.engine || new CBCAPPlanningEngine({
    evidenceOrigin: options.evidenceOrigin,
    fetchImpl: options.fetchImpl,
    auditSink: options.auditSink,
    memory: options.memory,
    harness: options.harness,
    killSwitch: options.killSwitch,
    clock: options.clock,
  });

  return {
    async handle(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { statusCode: 400, body: { error: 'request body must be an object' } };
      }
      const location = typeof input.location === 'string' ? input.location.trim() : '';
      if (!location) return { statusCode: 400, body: { error: 'location is required' } };
      if (location.length > 120) return { statusCode: 400, body: { error: 'location is too long' } };

      let assumptions;
      try {
        assumptions = validateAssumptions(input.assumptions);
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }

      let approval;
      if (input.approval !== undefined && input.approval !== null) {
        if (!isApprovedHumanRecord(input.approval)) {
          return {
            statusCode: 400,
            body: {
              error: 'approval must include status=approved, reviewer identity, county_plan scope, and a valid reviewedAt timestamp',
            },
          };
        }
        approval = clone(input.approval);
      }

      const resolved = await geographyAgent.resolve(location);
      const geographyBlock = geographyResponse(resolved, location);
      if (geographyBlock) return { statusCode: 409, body: geographyBlock };

      const request = { countyFips: resolved.fips };
      if (assumptions !== undefined) request.assumptions = assumptions;
      if (approval !== undefined) request.approval = approval;

      let result;
      try {
        result = await engine.buildCountyPlan(request);
      } catch (error) {
        return {
          statusCode: 502,
          body: {
            status: 'evidence_unavailable',
            error: {
              code: 'evidence_unavailable',
              reason: 'The governed evidence source could not complete this request.',
            },
          },
        };
      }

      const body = {
        ...result,
        placeResolution: {
          status: 'resolved',
          countyFips: resolved.fips,
          county: resolved.county || null,
          state: resolved.state || null,
          resolvedAs: resolved.resolvedAs || null,
          input: location,
        },
      };

      if (result.status === 'awaiting_human_review') return { statusCode: 202, body };
      if (result.status === 'approved_output') return { statusCode: 200, body };
      if (result.error?.code === 'node_error') {
        return {
          statusCode: 502,
          body: {
            status: 'evidence_unavailable',
            runId: result.runId || null,
            error: {
              code: 'evidence_unavailable',
              reason: 'The governed evidence source could not complete this request.',
            },
            placeResolution: body.placeResolution,
          },
        };
      }
      return { statusCode: 422, body };
    },
  };
}

module.exports = {
  createCBCAPApi,
  validateAssumptions,
};
