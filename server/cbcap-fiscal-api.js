const { buildFiscalView } = require('../packages/cbcap/fiscal-intelligence');
const { permissionDecision } = require('../packages/runtime/workspace-identity');
function createCBCAPFiscalApi({ recordsForActor, auditSink = () => {} } = {}) {
  if (typeof recordsForActor !== 'function') throw new Error('A reviewed fiscal evidence provider is required.');
  return { async handle(input, context = {}) {
    const decision = permissionDecision(context.workspaceActor,'cbcap.fiscal.view');
    if (!decision.ok) return {statusCode:403,body:{error:'Fiscal evidence access is not authorized.'}};
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !['countyFips','assumptions'].includes(key)) || !/^\d{5}$/.test(input.countyFips || '')) return {statusCode:400,body:{error:'Select an exact county and explicit assumptions.'}};
    let records;
    try { records = await recordsForActor(decision.actor,input.countyFips); }
    catch { return {statusCode:503,body:{error:'Reviewed fiscal evidence is unavailable.'}}; }
    try {
      const body = buildFiscalView({records,tenantId:decision.actor.tenantId,countyFips:input.countyFips,assumptions:input.assumptions});
      auditSink({action:'cbcap_fiscal_view_created',tenantId:decision.actor.tenantId,principalId:decision.actor.principalId,countyFips:input.countyFips,recordIds:body.facts.map(record => record.id),scenarioCount:body.scenarios.length});
      return {statusCode:200,body};
    } catch { return {statusCode:422,body:{error:'Fiscal evidence or assumptions do not meet the reviewed contract.'}}; }
  }};
}
module.exports = {createCBCAPFiscalApi};
