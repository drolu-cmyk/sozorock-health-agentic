/**
 * Shared Session Model
 *
 * Enables multiple humans and agents to collaborate on the same county plan.
 * Session state is stored in localStorage and can be shared via URL parameter
 * (?session=ID). This is the lightweight multiplayer layer.
 *
 * Design goals:
 * - Shareable live place plans (Cloud for Small Software)
 * - Multiple participants can view and append to the same plan
 * - Agents write into the same session as humans
 */

window.SozoRockSession = (function () {
  var STORAGE_KEY = "sozorock_sessions";
  var currentId = null;

  function generateId() {
    return "ses_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveAll(all) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  function create(initialPlace) {
    var id = generateId();
    var session = {
      id: id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      place: initialPlace || null,
      participants: ["local-user"],
      events: [],
      plan: {
        actions: [],
        hubs: [],
        notes: []
      }
    };
    var all = loadAll();
    all[id] = session;
    saveAll(all);
    currentId = id;
    return session;
  }

  function get(id) {
    var all = loadAll();
    return all[id] || null;
  }

  function getCurrent() {
    if (!currentId) {
      // Try URL param first
      var params = new URLSearchParams(window.location.search);
      var fromUrl = params.get("session");
      if (fromUrl && get(fromUrl)) {
        currentId = fromUrl;
      }
    }
    return currentId ? get(currentId) : null;
  }

  function setCurrent(id) {
    currentId = id;
    // Update URL without reload
    var url = new URL(window.location.href);
    url.searchParams.set("session", id);
    window.history.replaceState({}, "", url);
  }

  function appendEvent(type, payload, actor) {
    var session = getCurrent();
    if (!session) return null;
    var event = {
      id: "evt_" + Date.now().toString(36),
      type: type,
      actor: actor || "local-user",
      payload: payload,
      at: new Date().toISOString()
    };
    session.events.push(event);
    session.updatedAt = event.at;
    var all = loadAll();
    all[session.id] = session;
    saveAll(all);
    return event;
  }

  function updatePlan(updates) {
    var session = getCurrent();
    if (!session) return null;
    Object.assign(session.plan, updates);
    session.updatedAt = new Date().toISOString();
    var all = loadAll();
    all[session.id] = session;
    saveAll(all);
    return session;
  }

  function shareUrl() {
    var session = getCurrent();
    if (!session) return null;
    var url = new URL(window.location.href);
    url.searchParams.set("session", session.id);
    return url.toString();
  }

  return {
    create: create,
    get: get,
    getCurrent: getCurrent,
    setCurrent: setCurrent,
    appendEvent: appendEvent,
    updatePlan: updatePlan,
    shareUrl: shareUrl,
    generateId: generateId
  };
})();
