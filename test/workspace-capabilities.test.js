const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstitutionalCBCAPGateway } = require('../server/institutional-cbcap-gateway');
const actor = { tenantId:'county-a', principalId:'planner', role:'county_planner', access:'contributor' };
function gateway(options = {}) {
  return createInstitutionalCBCAPGateway({ identityResolver: async () => options.actor || actor, runtimeForActor: async () => ({ tenantId:options.tenant || actor.tenantId, evidenceReadyForCounty:async () => options.evidence === true, planningApi:{handle(){}}, reviewApi:{handle(){}}, ...options.services }) });
}
test('capability discovery rejects invalid identity and cross-tenant runtime', async () => {
  assert.equal((await gateway({actor:{}}).handleCapabilities({countyFips:'36001'})).statusCode,403);
  assert.equal((await gateway({tenant:'county-b'}).handleCapabilities({countyFips:'36001'})).statusCode,503);
});
test('registered routes do not establish evidence or provider readiness', async () => {
  const { body } = await gateway().handleCapabilities({countyFips:'36001'});
  assert.equal(body.capabilities.planning,false);
  assert.equal(body.capabilities.funding,false);
  assert.equal(body.capabilities.workforce,false);
});
test('exact county evidence and user permission are both required', async () => {
  const ready = await gateway({evidence:true}).handleCapabilities({countyFips:'36001'});
  assert.equal(ready.body.capabilities.planning,true);
  const viewer = await gateway({evidence:true,actor:{...actor,role:'research_funder_viewer',access:'viewer'}}).handleCapabilities({countyFips:'36001'});
  assert.equal(viewer.body.capabilities.planning,false);
  assert.equal(viewer.body.capabilities.review,false);
  assert.equal((await gateway().handleCapabilities({countyFips:'36001',tenantId:'county-b'})).statusCode,400);
});
