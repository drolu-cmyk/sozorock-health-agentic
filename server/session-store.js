/**
 * Durable Session Store
 *
 * File-backed JSON store so shared plans survive process restart.
 * Production path: replace with Postgres + row-level auth.
 *
 * This is collaborative storage (shared plan document), not yet
 * live multiplayer with presence/WebSocket.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../data/sessions");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function fileFor(id) {
  // prevent path traversal
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(DATA_DIR, safe + ".json");
}

function create(initial) {
  ensureDir();
  const id = crypto.randomBytes(6).toString("hex");
  const session = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    location: initial.location || null,
    plan: initial.plan || null,
    cbcapPlan: initial.cbcapPlan || null,
    events: [],
    participants: 1
  };
  fs.writeFileSync(fileFor(id), JSON.stringify(session, null, 2));
  return session;
}

function get(id) {
  ensureDir();
  const p = fileFor(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function update(id, patch) {
  const session = get(id);
  if (!session) return null;
  if (patch.plan !== undefined) session.plan = patch.plan;
  if (patch.cbcapPlan !== undefined) session.cbcapPlan = patch.cbcapPlan;
  if (patch.location !== undefined) session.location = patch.location;
  if (patch.events) session.events = patch.events;
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(fileFor(id), JSON.stringify(session, null, 2));
  return session;
}

function appendEvent(id, event) {
  const session = get(id);
  if (!session) return null;
  session.events = session.events || [];
  session.events.push({
    id: "evt_" + Date.now().toString(36),
    at: new Date().toISOString(),
    ...event
  });
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(fileFor(id), JSON.stringify(session, null, 2));
  return session;
}

module.exports = {
  create,
  get,
  update,
  appendEvent,
  DATA_DIR
};
