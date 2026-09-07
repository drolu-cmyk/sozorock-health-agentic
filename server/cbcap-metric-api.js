const { permissionDecision } = require('../packages/runtime/workspace-identity');
function createCBCAPMetricApi({ storeForActor } = {}) {
  if(typeof storeForActor !== 'function')throw new Error('Tenant metric registry provider is required.');
  return {async handle(input,context={}) {
    const action={list:'cbcap.metrics.read',create:'cbcap.metrics.write',review:'cbcap.metrics.review'}[input?.action];
    const decision=permissionDecision(context.workspaceActor,action);if(!decision.ok)return {statusCode:403,body:{error:'Metric action is not authorized.'}};
    const allowed={list:['action','countyFips'],create:['action','definition'],review:['action','id','version']}[input.action];
    if(Object.keys(input).some(key=>!allowed.includes(key)))return {statusCode:400,body:{error:'Unsupported metric request.'}};
    try {const store=await storeForActor(decision.actor);if(!store || store.tenantId!==decision.actor.tenantId)return {statusCode:503,body:{error:'Metric registry is unavailable.'}};
      const result=input.action==='list'?await store.list(input.countyFips,decision.actor):input.action==='create'?await store.create(input.definition,decision.actor):await store.review(input.id,input.version,decision.actor);
      return {statusCode:200,body:{contract:'cbcap.metric-registry.v1',result}};
    }catch(error){return {statusCode:error.code==='VERSION_CONFLICT'?409:422,body:{error:'Metric definition or review could not be accepted.'}};}
  }};
}
module.exports={createCBCAPMetricApi};
