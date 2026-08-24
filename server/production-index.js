const crypto = require('node:crypto');
const express = require('express');
const { createApp, parseAllowedOrigins } = require('./app');
const { createCognitoPostgresInstitutionalGateway } = require('./cognito-postgres-institutional-runtime');
const { closePool, createProductionPool, requiredEnv } = require('./production-database');
const { createS3PrivateEvidenceObjectResolver } = require('./s3-private-evidence-object-resolver');

function parseAllowedHosts(value) {
  const hosts = new Set(String(value || '').split(';').map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (!hosts.size) throw new Error('At least one production host is required.');
  for (const host of hosts) {
    if (host === '*' || host.includes('://') || !/^[a-z0-9.-]+$/.test(host)) throw new Error('Production host allowlist is invalid.');
  }
  return hosts;
}

function createProductionAuditSink(logger = console) {
  return function productionAuditSink(event = {}) {
    const payload = {
      type: 'cbcap_audit',
      recordedAt: new Date().toISOString(),
      ...event,
    };
    logger.log(JSON.stringify(payload));
  };
}

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

function createProductionApiOnlyApp(innerApp) {
  if (typeof innerApp !== 'function') throw new Error('Production API boundary requires an Express application.');
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (req.path === '/api/cbcap' || req.path.startsWith('/api/cbcap/')) return innerApp(req, res, next);
    return res.sendStatus(404);
  });
  return app;
}

function createProductionEdge(innerApp, options = {}) {
  const allowedHosts = options.allowedHosts;
  const readinessProbe = options.readinessProbe;
  if (!(allowedHosts instanceof Set) || !allowedHosts.size) throw new Error('Production edge requires an allowed-host set.');
  if (typeof readinessProbe !== 'function') throw new Error('Production edge requires a readiness probe.');

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const healthProbe = req.path === '/healthz' || req.path === '/readyz';
    if (!healthProbe) {
      const authority = String(req.get('host') || '').trim().toLowerCase();
      const host = authority.startsWith('[') ? authority : authority.split(':')[0];
      if (!allowedHosts.has(host)) return res.status(421).json({ error: 'Misdirected request' });
    }

    const suppliedRequestId = String(req.get('x-request-id') || '').trim();
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api/') || healthProbe) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      res.setHeader('Cache-Control', 'no-store');
    }
    return next();
  });

  app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'cbcap-agentic-runtime' }));
  app.get('/readyz', async (_req, res) => {
    try {
      const result = await readinessProbe();
      if (!result?.ok) return res.status(503).json({ status: 'not_ready' });
      return res.json({ status: 'ready' });
    } catch {
      return res.status(503).json({ status: 'not_ready' });
    }
  });
  app.use(innerApp);
  return app;
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
  const userPoolId = requiredEnv(env, 'CB_CAP_COGNITO_USER_POOL_ID', 160);
  const appClientId = requiredEnv(env, 'CB_CAP_COGNITO_APP_CLIENT_ID', 128);
  const privateEvidenceBucket = requiredEnv(env, 'CB_CAP_PRIVATE_EVIDENCE_BUCKET', 63);
  const privateEvidenceKmsKeyArn = requiredEnv(env, 'CB_CAP_PRIVATE_EVIDENCE_KMS_KEY_ARN', 500);
  const pool = options.pool || createProductionPool(env);
  const auditSink = options.auditSink || createProductionAuditSink(options.logger || console);
  const privateEvidenceObjectForActor = options.privateEvidenceObjectForActor || createS3PrivateEvidenceObjectResolver({
    region,
    bucket: privateEvidenceBucket,
    kmsKeyArn: privateEvidenceKmsKeyArn,
    client: options.s3Client,
  });

  try {
    await pool.query('SELECT 1 AS ok');
    const institutionalCBCAPGateway = createCognitoPostgresInstitutionalGateway({
      pool,
      region,
      userPoolId,
      appClientId,
      evidenceOrigin,
      privateEvidenceObjectForActor,
      publishHandlerForActor: options.publishHandlerForActor || productionPublishHandlerForActor,
      auditSink,
    });

    const readinessProbe = async () => {
      try {
        const result = await pool.query('SELECT 1 AS ok');
        return { ok: result.rows?.[0]?.ok === 1 };
      } catch {
        return { ok: false };
      }
    };

    const innerApp = createApp({
      institutionalCBCAPGateway,
      allowedOrigins,
      auditSink,
      enableLegacySessions: false,
      allowUnauthenticatedDevCBCAP: false,
    });
    const apiOnlyApp = createProductionApiOnlyApp(innerApp);
    const app = createProductionEdge(apiOnlyApp, { allowedHosts, readinessProbe });
    auditSink({ action: 'production_runtime_composed', institutionalAccessEnabled: true, tenantPrivateEvidenceEnabled: true });
    return { app, pool, auditSink };
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
    runtime.auditSink({ action: 'production_runtime_started', port });
  });

  async function shutdown(signal) {
    runtime.auditSink({ action: 'production_runtime_shutdown', signal });
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
  createProductionApiOnlyApp,
  createProductionAuditSink,
  createProductionEdge,
  createProductionRuntime,
  parseAllowedHosts,
  productionPublishHandlerForActor,
};
