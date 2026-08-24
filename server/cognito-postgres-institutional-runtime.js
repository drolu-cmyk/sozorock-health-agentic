const { createCognitoWorkspaceResolver } = require('./cognito-get-user-provider');
const { createPostgresRunMemoryFactory } = require('./postgres-tenant-memory');
const { createInstitutionalCBCAPGateway } = require('./institutional-cbcap-gateway');
const { createTenantCBCAPRuntimeFactory } = require('./tenant-cbcap-runtime');

function createCognitoPostgresInstitutionalGateway(options = {}) {
  const identityResolver = options.identityResolver || createCognitoWorkspaceResolver({
    region: options.region || process.env.AWS_REGION,
    fetchImpl: options.cognitoFetchImpl,
    timeoutMs: options.cognitoTimeoutMs,
  });

  const memoryForActor = options.memoryForActor || createPostgresRunMemoryFactory({
    pool: options.pool,
    statementTimeoutMs: options.statementTimeoutMs,
    clock: options.clock,
    runsTable: options.runsTable,
    eventsTable: options.eventsTable,
  });

  const runtimeForActor = options.runtimeForActor || createTenantCBCAPRuntimeFactory({
    memoryForActor,
    evidenceClientForActor: options.evidenceClientForActor,
    evidenceOrigin: options.evidenceOrigin,
    fetchImpl: options.evidenceFetchImpl,
    scenarioHandlerForActor: options.scenarioHandlerForActor,
    publishHandlerForActor: options.publishHandlerForActor,
    auditSink: options.auditSink,
    harness: options.harness,
    killSwitch: options.killSwitch,
    clock: options.clock,
  });

  return createInstitutionalCBCAPGateway({
    identityResolver,
    runtimeForActor,
    auditSink: options.auditSink,
  });
}

module.exports = { createCognitoPostgresInstitutionalGateway };
