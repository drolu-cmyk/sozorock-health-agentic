const express = require('express');
const path = require('path');
const { createPlaceIntelligenceAPI } = require('./place-intelligence-api');
const { createCBCAPService } = require('../packages/cbcap/governed-service');
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
  const legacySessionStore = options.sessionStore || defaultSessionStore;
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};
  const placeAPI = options.placeAPI || createPlaceIntelligenceAPI({ onAudit: auditSink });
  const cbcapService = options.cbcapService || createCBCAPService({
    evidenceGatewayOrigin: options.evidenceGatewayOrigin,
    fetchImpl: options.fetchImpl,
    killSwitch: options.killSwitch,
  });

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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
      version: '0.6.0',
      runtime: 'governed-graph',
      time: new Date().toISOString(),
      geography: countyMeta(),
      zipCrosswalk: zipMeta(),
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
      const result = await cbcapService.handle(req.body || {});
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal error' });
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

  // Audit events remain server-side until an authenticated governance console exists.
  app.get('/api/audit', (_req, res) => res.sendStatus(404));

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
