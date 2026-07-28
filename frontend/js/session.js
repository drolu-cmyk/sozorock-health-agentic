/**
 * Shared Session Model
 *
 * Sessions live on the server so a shared link works for a second browser.
 * localStorage is only used as a cache of the current session id.
 *
 * This is still an in-memory store on the server (demo durability).
 * Production: replace with Redis or Postgres.
 */

window.SozoRockSession = (function () {
  var currentId = null;

  function setCurrent(id) {
    currentId = id;
    try { localStorage.setItem("sozorock_current_session", id); } catch (e) {}
    var url = new URL(window.location.href);
    url.searchParams.set("session", id);
    window.history.replaceState({}, "", url);
  }

  function getCurrentId() {
    if (currentId) return currentId;
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get("session");
    if (fromUrl) {
      currentId = fromUrl;
      return currentId;
    }
    try {
      currentId = localStorage.getItem("sozorock_current_session");
    } catch (e) {}
    return currentId;
  }

  function create(location, plan) {
    return fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: location || null, plan: plan || null })
    }).then(function (r) { return r.json(); })
      .then(function (session) {
        setCurrent(session.id);
        return session;
      });
  }

  function get(id) {
    return fetch("/api/sessions/" + id).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    });
  }

  function getCurrent() {
    var id = getCurrentId();
    if (!id) return Promise.resolve(null);
    return get(id);
  }

  function updatePlan(updates) {
    var id = getCurrentId();
    if (!id) return Promise.resolve(null);
    return fetch("/api/sessions/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    }).then(function (r) { return r.json(); });
  }

  function shareUrl() {
    var id = getCurrentId();
    if (!id) return null;
    var url = new URL(window.location.href);
    url.searchParams.set("session", id);
    return url.toString();
  }

  // On load, if URL has a session, adopt it
  function initFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get("session");
    if (fromUrl) {
      currentId = fromUrl;
      return get(fromUrl).then(function (session) {
        if (session) setCurrent(session.id);
        return session;
      });
    }
    return Promise.resolve(null);
  }

  return {
    create: create,
    get: get,
    getCurrent: getCurrent,
    getCurrentId: getCurrentId,
    setCurrent: setCurrent,
    updatePlan: updatePlan,
    shareUrl: shareUrl,
    initFromUrl: initFromUrl
  };
})();
