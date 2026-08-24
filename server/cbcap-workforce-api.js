const { buildWorkforceCapacityView } = require('../packages/cbcap/workforce-capacity');

const COUNTY_FIPS = /^\d{5}$/;
const ALLOWED_FIELDS = new Set(['countyFips']);

function createCBCAPWorkforceApi(options = {}) {
  const evidenceClient = options.evidenceClient;
  if (!evidenceClient || typeof evidenceClient.getCountyPackage !== 'function') {
    throw new Error('Workforce Intelligence requires a governed Evidence Gateway client.');
  }
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};

  return {
    async handle(input = {}, context = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { statusCode: 400, body: { error: 'Workforce request must be an object.' } };
      }
      const unknown = Object.keys(input).filter((key) => !ALLOWED_FIELDS.has(key));
      if (unknown.length) {
        return { statusCode: 400, body: { error: 'Workforce request accepts countyFips only.' } };
      }
      const countyFips = String(input.countyFips || '').trim();
      if (!COUNTY_FIPS.test(countyFips)) {
        return { statusCode: 400, body: { error: 'countyFips must be a five-digit county FIPS.' } };
      }

      try {
        const evidence = await evidenceClient.getCountyPackage(countyFips);
        const result = buildWorkforceCapacityView(evidence, countyFips);
        auditSink({
          action: 'cbcap_workforce_capacity_evaluated',
          tenantId: context.workspaceActor?.tenantId || null,
          principalId: context.workspaceActor?.principalId || null,
          countyFips,
          releaseId: result.evidenceRelease.releaseId,
          evidenceState: result.evidenceState,
          designations: result.designations.length,
          capacityObservations: result.capacityObservations.length,
        });
        return { statusCode: 200, body: result };
      } catch (error) {
        auditSink({
          action: 'cbcap_workforce_capacity_failed',
          tenantId: context.workspaceActor?.tenantId || null,
          principalId: context.workspaceActor?.principalId || null,
          countyFips,
          errorName: error?.name || 'Error',
        });
        return { statusCode: 503, body: { error: 'Governed workforce evidence is temporarily unavailable.' } };
      }
    },
  };
}

module.exports = { createCBCAPWorkforceApi };
