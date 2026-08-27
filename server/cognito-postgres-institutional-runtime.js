const { createCognitoWorkspaceResolver } = require('./cognito-get-user-provider');
const {
  createPostgresInstitutionalMemoryFactory,
  createPostgresLearningMemoryFactory,
  createPostgresMonitoringFindingStoreFactory,
  createPostgresRunMemoryFactory,
  createPostgresTenantPrivateEvidenceStoreFactory,
  createPostgresWorkspaceMemoryFactory,
} = require('./postgres-tenant-memory');
const { createInstitutionalCBCAPGateway } = require('./institutional-cbcap-gateway');
const { createTenantCBCAPRuntimeFactory } = require('./tenant-cbcap-runtime');

function createCognitoPostgresInstitutionalGateway(options = {}) {
  const identityResolver = options.identityResolver || createCognitoWorkspaceResolver({
    region: options.region || process.env.AWS_REGION,
    userPoolId: options.userPoolId || process.env.CB_CAP_COGNITO_USER_POOL_ID,
    appClientId: options.appClientId || process.env.CB_CAP_COGNITO_APP_CLIENT_ID,
    fetchImpl: options.cognitoFetchImpl,
    timeoutMs: options.cognitoTimeoutMs,
  });

  let runtimeForActor = options.runtimeForActor;
  if (!runtimeForActor) {
    const requiresPool = !options.memoryForActor
      || !options.workspaceMemoryForActor
      || !options.institutionalMemoryForActor;
    if (requiresPool && (!options.pool || typeof options.pool.connect !== 'function')) {
      throw new Error('PostgreSQL institutional runtime requires a pool with connect() unless all memory factories are supplied.');
    }

    const sharedPoolOptions = {
      pool: options.pool,
      statementTimeoutMs: options.statementTimeoutMs,
      clock: options.clock,
    };
    const memoryForActor = options.memoryForActor || createPostgresRunMemoryFactory({
      ...sharedPoolOptions,
      runsTable: options.runsTable,
      eventsTable: options.eventsTable,
    });
    const workspaceMemoryForActor = options.workspaceMemoryForActor || createPostgresWorkspaceMemoryFactory(sharedPoolOptions);
    const institutionalMemoryForActor = options.institutionalMemoryForActor || createPostgresInstitutionalMemoryFactory(sharedPoolOptions);
    const learningMemoryForActor = options.learningMemoryForActor
      || (options.pool && typeof options.pool.connect === 'function'
        ? createPostgresLearningMemoryFactory(sharedPoolOptions)
        : null);
    const monitoringFindingStoreForActor = options.monitoringFindingStoreForActor
      || (options.pool && typeof options.pool.connect === 'function'
        ? createPostgresMonitoringFindingStoreFactory(sharedPoolOptions)
        : null);
    const privateEvidenceStoreForActor = options.privateEvidenceStoreForActor
      || (options.pool && typeof options.pool.connect === 'function'
        ? createPostgresTenantPrivateEvidenceStoreFactory(sharedPoolOptions)
        : null);

    runtimeForActor = createTenantCBCAPRuntimeFactory({
      memoryForActor,
      workspaceMemoryForActor,
      institutionalMemoryForActor,
      learningMemoryForActor,
      monitoringFindingStoreForActor,
      monitoringDefinitionForActor: options.monitoringDefinitionForActor,
      monitoringSnapshotForActor: options.monitoringSnapshotForActor,
      privateEvidenceStoreForActor,
      privateEvidenceObjectForActor: options.privateEvidenceObjectForActor,
      institutionalEvidenceValidatorForActor: options.institutionalEvidenceValidatorForActor,
      evidenceClientForActor: options.evidenceClientForActor,
      evidenceOrigin: options.evidenceOrigin,
      fetchImpl: options.evidenceFetchImpl,
      scenarioRegistrationsForActor: options.scenarioRegistrationsForActor,
      scenarioHandlerForActor: options.scenarioHandlerForActor,
      publishHandlerForActor: options.publishHandlerForActor,
      agentOrchestratorForActor: options.agentOrchestratorForActor,
      fundingOpportunityForActor: options.fundingOpportunityForActor,
      fundingApplicantProfileForActor: options.fundingApplicantProfileForActor,
      auditSink: options.auditSink,
      harness: options.harness,
      killSwitch: options.killSwitch,
      clock: options.clock,
    });
  }

  return createInstitutionalCBCAPGateway({
    identityResolver,
    runtimeForActor,
    auditSink: options.auditSink,
  });
}

module.exports = { createCognitoPostgresInstitutionalGateway };
