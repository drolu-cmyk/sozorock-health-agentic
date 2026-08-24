const express = require('express');
const path = require('path');
const { createPlaceIntelligenceAPI } = require('./place-intelligence-api');
const { createCBCAPApi } = require('./cbcap-api');
const defaultSessionStore = require('./session-store');
const { getMeta: countyMeta } = require('../packages/data/national-counties');
const { getMeta: zipMeta } = require('../packages/data/zip-crosswalk');

function parseAllowedOrigins(value) {
  const source = value || 'https://cbcap.sozorockfoundation.org;https://health.sozorockfoundation.org';
  return new Set(String(source).split(';').map((item) => item.trim()).filter(Boolean));
}

function createApp(options = {}) {
  const app = express();
  const allowedOrigins = options.allowedOrigins instanceof Set
    ? options.allowedOrigins
    : parseAllowedOrigins(options.allowedOrigins || process.env.AGENTIC_ALLOWED_ORIGINS);
  const enableLegacySessions = options.enableLegacySessions ?? process.env.ENABLE_LEGACY_SESSIONS === 'true';
  const allowUnauthenticatedDevCBCAP = options.allowUnauthenticatedDevCBCAP
    ?? process.env.ENABLE_UNAUTHENTICATED_CBCAP_DEV === 'true';
  const legacySessionStore = options.sessionStore || defaultSessionStore;
  const institutionalGateway = options.institutionalCBCAPGateway || null;
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};
  const placeAPI = options.placeAPI || createPlaceIntelligenceAPI({ onAudit: auditSink });
  const devCbcapAPI = allowUnauthenticatedDevCBCAP
    ? (options.cbcapAPI || createCBCAPApi({
        tenantId: options.tenantId,
        evidenceOrigin: options.evidenceOrigin,
        fetchImpl: options.fetchImpl,
        auditSink,
        memory: options.memory,
        harness: options.harness,
        killSwitch: options.killSwitch,
        clock: options.clock,
        scenarioHandler: options.scenarioHandler,
        publishHandler: options.publishHandler,
      }))
    : null;

  if (institutionalGateway) {
    if (typeof institutionalGateway.handlePlan !== 'function' || typeof institutionalGateway.handleReview !== 'function') {
      throw new Error('institutionalCBCAPGateway must expose handlePlan() and handleReview().');
    }
  }

  const workspaceMemoryRouteEnabled = Boolean(
    institutionalGateway
    && typeof institutionalGateway.handleWorkspaceList === 'function'
    && typeof institutionalGateway.handleWorkspaceCreate === 'function'
    && typeof institutionalGateway.handleWorkspaceUpdate === 'function',
  );
  const institutionalMemoryRouteEnabled = Boolean(
    institutionalGateway
    && typeof institutionalGateway.handleMemoryQuery === 'function'
    && typeof institutionalGateway.handleMemoryPropose === 'function'
    && typeof institutionalGateway.handleMemoryReview === 'function'
    && typeof institutionalGateway.handleMemorySupersede === 'function',
  );
  const monitoringIntelligenceRouteEnabled = Boolean(
    institutionalGateway && typeof institutionalGateway.handleMonitoring === 'function',
  );
  const workforceCapacityRouteEnabled = Boolean(
    institutionalGateway && typeof institutionalGateway.handleWorkforce === 'function',
  );

  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');

    const origin = req.get('origin');
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
    }
    if (req.method === 'OPTIONS') {
      if (origin && !allowedOrigins.has(origin)) return res.sendStatus(403);
      return res.sendStatus(204);
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'sozorock-health-agentic',
      version: '0.10.0',
      runtime: 'governed-graph',
      time: new Date().toISOString(),
      geography: countyMeta(),
      zipCrosswalk: zipMeta(),
      institutionalAccessEnabled: Boolean(institutionalGateway),
      reviewContinuationEnabled: Boolean(institutionalGateway),
      fundingIntelligenceRouteEnabled: Boolean(institutionalGateway && typeof institutionalGateway.handleFunding === 'function'),
      visualizationIntelligenceRouteEnabled: Boolean(institutionalGateway && typeof institutionalGateway.handleVisualization === 'function'),
      monitoringIntelligenceRouteEnabled,
      workforceCapacityRouteEnabled,
      workspaceMemoryRouteEnabled,
      institutionalMemoryRouteEnabled,
      unauthenticatedDevCBCAPEnabled: Boolean(devCbcapAPI),
      legacySessionsEnabled: enableLegacySessions,
    });
  });

  app.post('/api/place', async (req, res) => {
    try {
      const result = await placeAPI.handle(req.body || {});
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap', async (req, res) => {
    try {
      if (institutionalGateway) {
        const result = await institutionalGateway.handlePlan(req.body || {}, { request: req });
        return res.status(result.statusCode).json(result.body);
      }
      if (devCbcapAPI) {
        const result = await devCbcapAPI.handle(req.body || {});
        return res.status(result.statusCode).json(result.body);
      }
      return res.sendStatus(404);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/runs/:runId/review', async (req, res) => {
    try {
      if (!institutionalGateway) return res.sendStatus(404);
      const result = await institutionalGateway.handleReview(req.params.runId, req.body || {}, { request: req });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/funding/evaluate', async (req, res) => {
    try {
      if (!institutionalGateway || typeof institutionalGateway.handleFunding !== 'function') return res.sendStatus(404);
      const result = await institutionalGateway.handleFunding(req.body || {}, { request: req });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/visualizations/spec', async (req, res) => {
    try {
      if (!institutionalGateway || typeof institutionalGateway.handleVisualization !== 'function') return res.sendStatus(404);
      const result = await institutionalGateway.handleVisualization(req.body || {}, { request: req });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/workforce/capacity', async (req, res) => {
    try {
      if (!workforceCapacityRouteEnabled) return res.sendStatus(404);
      const result = await institutionalGateway.handleWorkforce(req.body || {}, { request: req });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/monitoring/evaluate', async (req, res) => {
    try {
      if (!monitoringIntelligenceRouteEnabled) return res.sendStatus(404);
      const result = await institutionalGateway.handleMonitoring(req.body || {}, { request: req });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/api/cbcap/workspaces/:workspaceId/items', async (req, res) => {
    try {
      if (!workspaceMemoryRouteEnabled) return res.sendStatus(404);
      const result = await institutionalGateway.handleWorkspaceList(req.params.workspaceId, req.query || {}, { request: req });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/workspaces/:workspaceId/items', async (req, res) => {
    try {
      if (!workspaceMemoryRouteEnabled) return res.sendStatus(404);
      const result = await institutionalGateway.handleWorkspaceCreate(
        { ...(req.body || {}), workspaceId: req.params.workspaceId },
        { request: req },
      );
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.put('/api/cbcap/workspaces/:workspaceId/items/:itemId', async (req, res) => {
    try {
      if (!workspaceMemoryRouteEnabled) return res.sendStatus(404);
      const result = await institutionalGateway.handleWorkspaceUpdate(
        req.params.workspaceId,
        req.params.itemId,
        req.body || {},
        { request: req },
      );
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/memory/query', async (req, res) => {
    try {
      if (!institutionalMemoryRouteEnabled) return res.sendStatus(404);
      const result = await institutionalGateway.handleMemoryQuery(req.body || {}, { request: req });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/memory/proposals', async (req, res) => {
    try {
      if (!institutionalMemoryRouteEnabled) return res.sendStatus(404);
      const result = await institutionalGateway.handleMemoryPropose(req.body || {}, { request: req });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/memory/proposals/:proposalId/review', async (req, res) => {
    try {
      if (!institutionalMemoryRouteEnabled) return res.sendStatus(404);
      const result = await institutionalGateway.handleMemoryReview(
        req.params.proposalId,
        req.body || {},
        { request: req },
      );
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/cbcap/memory/:memoryId/supersede', async (req, res) => {
    try {
      if (!institutionalMemoryRouteEnabled) return res.sendStatus(404);
      const result = await institutionalGateway.handleMemorySupersede(
        req.params.memoryId,
        req.body || {},
        { request: req },
      );
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  if (enableLegacySessions) {
    app.post('/api/sessions', (req, res) => {
      const session = legacySessionStore.create({
        location: req.body.location || null,
        plan: req.body.plan || null,
        cbcapPlan: req.body.cbcapPlan || null,
      });
      res.status(201).json(session);
    });

    app.get('/api/sessions/:id', (req, res) => {
      const session = legacySessionStore.get(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      return res.json(session);
    });

    app.put('/api/sessions/:id', (req, res) => {
      const session = legacySessionStore.update(req.params.id, {
        plan: req.body.plan,
        cbcapPlan: req.body.cbcapPlan,
        location: req.body.location,
      });
      if (!session) return res.status(404).json({ error: 'Session not found' });
      return res.json(session);
    });
  }

  app.get('/api/audit', (_req, res) => res.sendStatus(404));

  app.use('/api', (_req, res) => res.sendStatus(404));

  app.use(express.static(path.join(__dirname, '../frontend')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  });

  return app;
}

module.exports = {
  createApp,
  parseAllowedOrigins,
};