/**
 * Runnable server entry point
 *
 * Run:  node server/index.js
 * Or:   npm start
 */

const express = require("express");
const path = require("path");
const { createPlaceIntelligenceAPI } = require("./place-intelligence-api");
const { CBCAPPlanningEngine } = require("../packages/cbcap/planning-engine");
const sessionStore = require("./session-store");
const { getMeta: countyMeta } = require("../packages/data/national-counties");
const { getMeta: zipMeta } = require("../packages/data/zip-crosswalk");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "200kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const auditEvents = [];

function recordAudit(event) {
  auditEvents.push({
    id: "aud_" + Date.now().toString(36),
    action: event.action,
    fips: event.fips || null,
    purpose: event.purpose || null,
    at: new Date().toISOString(),
    durationMs: event.durationMs || null
  });
  console.log("[audit]", event.action, event.fips || "", event.purpose || "");
}

const placeAPI = createPlaceIntelligenceAPI({ onAudit: recordAudit });
const cbcapEngine = new CBCAPPlanningEngine({ auditSink: recordAudit });

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "sozorock-health-agentic",
    version: "0.5.0",
    time: new Date().toISOString(),
    geography: countyMeta(),
    zipCrosswalk: zipMeta()
  });
});

app.post("/api/place", async (req, res) => {
  try {
    const result = await placeAPI.handle(req.body || {});
    res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

app.post("/api/cbcap", async (req, res) => {
  try {
    const location = (req.body && req.body.location) || "";
    if (!location) return res.status(400).json({ error: "location is required" });
    const plan = await cbcapEngine.buildCountyPlan(location);
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

app.post("/api/sessions", (req, res) => {
  const session = sessionStore.create({
    location: req.body.location || null,
    plan: req.body.plan || null,
    cbcapPlan: req.body.cbcapPlan || null
  });
  res.status(201).json(session);
});

app.get("/api/sessions/:id", (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.put("/api/sessions/:id", (req, res) => {
  const session = sessionStore.update(req.params.id, {
    plan: req.body.plan,
    cbcapPlan: req.body.cbcapPlan,
    location: req.body.location
  });
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.get("/api/audit", (req, res) => {
  res.json(auditEvents);
});

app.use(express.static(path.join(__dirname, "../frontend")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.listen(PORT, () => {
  console.log(`SozoRock Health Agentic v0.5.0 on http://localhost:${PORT}`);
  console.log(`  geography: ${countyMeta().count} counties (${countyMeta().source})`);
  console.log(`  zip crosswalk: ${zipMeta().count} ZIPs (${zipMeta().source})`);
});
