const { GeographyAgent } = require('../packages/agents/sub-agents/geography-agent');
const { CBCAPPlanningEngine } = require('../packages/cbcap/planning-engine');
const { hasUserAssumptions } = require('../packages/runtime/contracts');

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

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateScenarioContext(value, assumptions) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('scenario must be an object');
  }
  const keys = Object.keys(value);
  const unsupported = keys.filter((key) => !['asOf', 'horizonEnd'].includes(key));
  if (unsupported.length) {
    throw new Error(`scenario contains unsupported fields: ${unsupported.sort().join(', ')}`);
  }
  if (!assumptions) throw new Error('scenario requires explicit user assumptions');
  if (!validDateOnly(value.horizonEnd)) throw new Error('scenario.horizonEnd must be a valid YYYY-MM-DD date');
  if (value.asOf !== undefined && !validDateOnly(value.asOf)) {
    throw new Error('scenario.asOf must be a valid YYYY-MM-DD date');
  }
  if (value.asOf !== undefined && value.horizonEnd <= value.asOf) {
    throw new Error('scenario.horizonEnd must be after scenario.asOf');
  }
  return clone(value);
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
        kind: resolved.resolutionMethod === 'census_zcta_proxy' ? 'multi_county_census_zcta_proxy' : 'multi_county_usps_zip',
        query,
        resolutionMethod: resolved.resolutionMethod || null,
        caveat: resolved.caveat || null,
        matches: (resolved.allCounties || []).map((item) => ({
          countyFips: item.fips,
          county: item.name || null,
          residentialShare: item.resRatio ?? null,
          landAreaShare: item.areaRatio ?? null,
        })),
      },
    };
  }
  return null;
}

function createCBCAPApi(options = {}) {
  const geographyAgent = options.geographyAgent || new GeographyAgent();
  const engine = options.engine || new CBCAPPlanningEngine({
    tenantId: options.tenantId,
    evidenceOrigin: options.evidenceOrigin,
    fetchImpl: options.fetchImpl,
    auditSink: options.auditSink,
    memory: options.memory,
    harness: options.harness,
    killSwitch: options.killSwitch,
    clock: options.clock,
    scenarioHandler: options.scenarioHandler,
    publishHandler: options.publishHandler,
  });

  return {
    async handle(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { statusCode: 400, body: { error: 'request body must be an object' } };
      }
      const location = typeof input.location === 'string' ? input.location.trim() : '';
      if (!location) return { statusCode: 400, body: { error: 'location is required' } };
      if (location.length > 120) return { statusCode: 400, body: { error: 'location is too long' } };

      if (Object.prototype.hasOwnProperty.call(input, 'approval')) {
        return {
          statusCode: 400,
          body: {
            code: 'review_continuation_required',
            error: 'Approval is not accepted on the initial planning request. Review must continue the exact saved run and Evidence Gateway release.',
          },
        };
      }

      let assumptions;
      let scenario;
      try {
        assumptions = validateAssumptions(input.assumptions);
        scenario = validateScenarioContext(input.scenario, assumptions);
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }

      const resolved = await geographyAgent.resolve(location);
      const geographyBlock = geographyResponse(resolved, location);
      if (geographyBlock) return { statusCode: 409, body: geographyBlock };

      const request = { countyFips: resolved.fips };
      if (assumptions !== undefined) request.assumptions = assumptions;
      if (scenario !== undefined) request.scenario = scenario;

      let result;
      try {
        result = await engine.buildCountyPlan(request);
      } catch {
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
          resolutionMethod: resolved.resolutionMethod || null,
          caveat: resolved.caveat || null,
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
  validateScenarioContext,
};
