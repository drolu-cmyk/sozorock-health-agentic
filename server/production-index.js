const { createApp, parseAllowedHosts, parseAllowedOrigins } = require('./app');
const { createCognitoPostgresInstitutionalGateway } = require('./cognito-postgres-institutional-runtime');
const { closePool, createProductionPool, requiredEnv } = require('./production-database');

function productionPublishHandlerForActor(actor) {
  return async function publishApprovedCountyPlan(state) {
    if (!state || state.tenantId !== actor.tenantId || !state.runId || !state.evidence?.releaseId) {
      throw new Error('Approved county plan state is incomplete or belongs to another tenant.');
    }
    return {
      status: 'approved_artifact',
      runId: state.runId,
      tenantId: actor.tenantId,
      countyFips: state.countyFips || state.place?.countyFips || null,
      evidenceReleaseId: state.evidence.releaseId,
      approval: state.approval || null,
      artifactType: 'governed_county_planning_output',
      externalPublication: false,
    };
  };
}

async function createProductionRuntime(options = {}) {
  const env = options.env || process.env;
  if (String(env.ENABLE_UNAUTHENTICATED_CBCAP_DEV || '').toLowerCase() === 'true') {
    throw new Error('Unauthenticated development planning is forbidden in production.');
  }
  if (String(env.ENABLE_LEGACY_SESSIONS || '').toLowerCase() === 'true') {
    throw new Error('Legacy sessions are forbidden in production.');
  }

  const region = requiredEnv(env, 'AWS_REGION', 64);
  const evidenceOrigin = requiredEnv(env, 'EVIDENCE_GATEWAY_ORIGIN', 512);
  if (!evidenceOrigin.startsWith('https://')) throw new Error('EVIDENCE_GATEWAY_ORIGIN must use HTTPS.');
  const allowedOrigins = parseAllowedOrigins(requiredEnv(env, 'AGENTIC_ALLOWED_ORIGINS', 2048));
  const allowedHosts = parseAllowedHosts(requiredEnv(env, 'AGENTIC_ALLOWED_HOSTS', 1024));
  const pool = options.pool || createProductionPool(env);

  try {
    await pool.query('SELECT 1 AS ok');
    const institutionalCBCAPGateway = createCognitoPostgresInstitutionalGateway({
      pool,
      region,
      evidenceOrigin,
      publishHandlerForActor: options.publishHandlerForActor || productionPublishHandlerForActor,
      auditSink: options.auditSink,
    });

    const readinessProbe = async () => {
      try {
        const result = await pool.query('SELECT 1 AS ok');
        return { ok: result.rows?.[0]?.ok === 1 };
      } catch {
        return { ok: false };
      }
    };

    const app = createApp({
      institutionalCBCAPGateway,
      allowedOrigins,
      allowedHosts,
      readinessProbe,
      enableLegacySessions: false,
      allowUnauthenticatedDevCBCAP: false,
    });
    return { app, pool };
  } catch (error) {
    if (!options.pool) await closePool(pool).catch(() => {});
    throw error;
  }
}

async function main() {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid.');
  const runtime = await createProductionRuntime();
  const server = runtime.app.listen(port, '0.0.0.0', () => {
    console.log(`CB-CAP governed production runtime listening on ${port}`);
  });

  async function shutdown(signal) {
    console.log(`Received ${signal}; shutting down CB-CAP runtime.`);
    server.close(async () => {
      await closePool(runtime.pool).catch(() => {});
      process.exit(0);
    });
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || 'CB-CAP production runtime failed to start.');
    process.exitCode = 1;
  });
}

module.exports = {
  createProductionRuntime,
  productionPublishHandlerForActor,
};
