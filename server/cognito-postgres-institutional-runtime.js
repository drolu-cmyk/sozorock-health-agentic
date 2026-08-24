const { createCognitoWorkspaceResolver } = require('./cognito-get-user-provider');
const {
  createPostgresInstitutionalMemoryFactory,
  createPostgresLearningMemoryFactory,
  createPostgresRunMemoryFactory,
  createPostgresWorkspaceMemoryFactory,
} = require('./postgres-tenant-memory');
const { createInstitutionalCBCAPGateway } = require('./institutional-cbcap-gateway');
const { createTenantCBCAPRuntimeFactory } = require('./tenant-cbcap-runtime');

function createCognitoPostgresInstitutionalGateway(options = {}) {
  const identityResolver = options.identityResolver || createCognitoWorkspaceResolver({
    region: options.region || process.env.AWS_REGION,
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

    runtimeForActor = createTenantCBCAPRuntimeFactory({
      memoryForActor,
      workspaceMemoryForActor,
      institutionalMemoryForActor,
      learningMemoryForActor,
      institutionalEvidenceValidatorForActor: options.institutionalEvidenceValidatorForActor,
      evidenceClientForActor: options.evidenceClientForActor,
      evidenceOrigin: options.evidenceOrigin,
      fetchImpl: options.evidenceFetchImpl,
      scenarioRegistrationsForActor: options.scenarioRegistrationsForActor,
      scenarioHandlerForActor: options.scenarioHandlerForActor,
      publishHandlerForActor: options.publishHandlerForActor,
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
