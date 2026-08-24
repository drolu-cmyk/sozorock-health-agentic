const { evaluateFundingFit } = require('../packages/cbcap/funding-intelligence');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

function clientString(value, label, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('request body must be an object');
  const allowed = new Set(['opportunityId', 'countyId', 'stateId', 'asOf']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`Unsupported funding request field ${key}.`);
  }
  const opportunityId = clientString(input.opportunityId, 'opportunityId');
  const countyId = clientString(input.countyId, 'countyId');
  const stateId = input.stateId === undefined || input.stateId === null
    ? null
    : clientString(input.stateId, 'stateId');
  const asOf = input.asOf === undefined || input.asOf === null
    ? null
    : clientString(input.asOf, 'asOf', 40);
  if (asOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(`${asOf}T00:00:00Z`)))) {
    throw new Error('asOf must use YYYY-MM-DD.');
  }
  return { opportunityId, countyId, stateId, asOf };
}

function createCBCAPFundingApi(options = {}) {
  if (typeof options.opportunityForActor !== 'function') {
    throw new Error('Funding API requires opportunityForActor(actor, opportunityId).');
  }
  if (typeof options.applicantProfileForActor !== 'function') {
    throw new Error('Funding API requires applicantProfileForActor(actor).');
  }
  const opportunityForActor = options.opportunityForActor;
  const applicantProfileForActor = options.applicantProfileForActor;
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};

  return {
    async handle(input, context = {}) {
      let request;
      let actor;
      try {
        request = validateInput(input);
        actor = validateWorkspaceActor(context.workspaceActor);
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }

      let opportunity;
      let applicant;
      try {
        [opportunity, applicant] = await Promise.all([
          opportunityForActor(actor, request.opportunityId),
          applicantProfileForActor(actor),
        ]);
      } catch {
        return { statusCode: 503, body: { error: 'Governed funding intelligence sources are temporarily unavailable.' } };
      }
      if (!opportunity) return { statusCode: 404, body: { error: 'Reviewed funding opportunity was not found.' } };
      if (!applicant || applicant.tenantId !== actor.tenantId) {
        return { statusCode: 403, body: { error: 'Institutional funding profile authorization failed.' } };
      }

      let result;
      try {
        result = evaluateFundingFit({
          opportunity,
          applicant,
          countyId: request.countyId,
          stateId: request.stateId,
          asOf: request.asOf,
        });
      } catch {
        return { statusCode: 422, body: { error: 'Reviewed funding opportunity could not be evaluated under the governed contract.' } };
      }

      auditSink({
        action: 'cbcap_funding_fit_evaluated',
        tenantId: actor.tenantId,
        principalId: actor.principalId,
        opportunityId: result.opportunityId,
        requirementsStatus: result.requirementsStatus,
        fitStatus: result.fitStatus,
        evaluationStatus: result.status,
      });

      return {
        statusCode: result.status === 'blocked' ? 422 : 200,
        body: result,
      };
    },
  };
}

module.exports = {
  createCBCAPFundingApi,
  validateInput,
};
