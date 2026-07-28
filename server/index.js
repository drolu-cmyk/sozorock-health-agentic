/**
 * Runnable server entry point
 *
 * Starts a real HTTP server that:
 * - Serves the frontend
 * - Exposes POST /api/place  (Chief of Staff pipeline)
 * - Exposes session create / join for shared plans
 * - Exposes health check
 *
 * Run:  node server/index.js
 * Or:   npm start
 */

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createPlaceIntelligenceAPI } = require("./place-intelligence-api");
const { CBCAPPlanningEngine } = require("../packages/cbcap/planning-engine");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "100kb" }));

// CORS for local development
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---- Place Intelligence API ----
const placeAPI = createPlaceIntelligenceAPI({
  onAudit: (event) => {
    // In production this writes to durable storage
    console.log("[audit]", event.action, event.fips || "", event.purpose || "");
  }
});

const cbcapEngine = new CBCAPPlanningEngine();

// In-memory session store (demo). Production: Redis or Postgres.
const sessions = new Map();

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "sozorock-health-agentic",
    version: "0.4.0",
    time: new Date().toISOString()
  });
});

/**
 * POST /api/place
 * Body: { location: string, purpose?: "resident"|"planner"|"funder"|"cbcap" }
 */
app.post("/api/place", async (req, res) => {
  try {
    const result = await placeAPI.handle(req.body || {});
    res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error", message: err.message });
  }
});

/**
 * POST /api/cbcap
 * Body: { location: string }
 * Returns full CB-CAP county plan (distinct from place intelligence)
 */
app.post("/api/cbcap", async (req, res) => {
  try {
    const location = (req.body && req.body.location) || "";
    if (!location) return res.status(400).json({ error: "location is required" });
    const plan = await cbcapEngine.buildCountyPlan(location);
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error", message: err.message });
  }
});

/**
 * Session endpoints — shared live plan across browsers
 */
app.post("/api/sessions", (req, res) => {
  const id = crypto.randomBytes(6).toString("hex");
  const session = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    location: req.body.location || null,
    plan: req.body.plan || null,
    participants: 1
  };
  sessions.set(id, session);
  res.status(201).json(session);
});

app.get("/api/sessions/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.put("/api/sessions/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.plan = req.body.plan || session.plan;
  session.location = req.body.location || session.location;
  session.updatedAt = new Date().toISOString();
  session.participants = (session.participants || 1) + 0; // no increment on update
  sessions.set(req.params.id, session);
  res.json(session);
});

// Governance audit log (internal only — not exposed in resident UI)
app.get("/api/audit", (req, res) => {
  res.json(placeAPI.getAuditLog());
});

// Static frontend
app.use(express.static(path.join(__dirname, "../frontend")));

// Fallback to index
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.listen(PORT, () => {
  console.log(`SozoRock Health Agentic listening on http://localhost:${PORT}`);
  console.log(`  POST /api/place`);
  console.log(`  POST /api/cbcap`);
  console.log(`  GET  /api/health`);
});
