/**
 * Audit Log + Policy Enforcement
 *
 * Records every agent and user action with source-traceable metadata.
 * Enforces non-clinical constraints before results are shown.
 *
 * This is the compliance layer that makes the system auditable and fundable.
 */

window.SozoRockAudit = (function () {
  var LOG_KEY = "sozorock_audit_log";
  var MAX_ENTRIES = 200;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function save(entries) {
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(entries.length - MAX_ENTRIES);
    }
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  }

  /**
   * Policy checks that must pass before any place result is rendered.
   * Returns { ok: boolean, violations: string[] }
   */
  function enforcePolicy(result) {
    var violations = [];

    if (!result) {
      violations.push("Empty result");
      return { ok: false, violations: violations };
    }

    // Non-clinical constraint
    if (result.clinicalAdvice || result.diagnosis || result.treatment) {
      violations.push("Clinical content detected — blocked by non-clinical policy");
    }

    // Source-traceable requirement
    if (result.meta && result.meta.sourceTraceable === false) {
      violations.push("Result lacks source-traceable flag");
    }

    // Must declare non-clinical
    if (result.meta && result.meta.nonClinical !== true) {
      violations.push("Result missing nonClinical=true declaration");
    }

    return {
      ok: violations.length === 0,
      violations: violations
    };
  }

  function record(action, detail, actor) {
    var entry = {
      id: "aud_" + Date.now().toString(36),
      action: action,
      detail: detail || {},
      actor: actor || "system",
      at: new Date().toISOString()
    };
    var entries = load();
    entries.push(entry);
    save(entries);
    renderLog();
    return entry;
  }

  function renderLog() {
    var el = document.getElementById("auditLog");
    if (!el) return;
    var entries = load().slice(-12).reverse();
    el.innerHTML = entries.map(function (e) {
      return (
        '<div class="text-xs border-b border-slate-100 py-1.5">' +
        '<span class="font-medium text-slate-700">' + e.action + '</span>' +
        '<span class="text-slate-400 ml-2">' + e.actor + '</span>' +
        '<div class="text-slate-500 truncate">' + (e.detail.summary || JSON.stringify(e.detail).slice(0, 80)) + '</div>' +
        '</div>'
      );
    }).join("") || '<div class="text-xs text-slate-400">No actions yet</div>';
  }

  function getAll() {
    return load();
  }

  return {
    record: record,
    enforcePolicy: enforcePolicy,
    renderLog: renderLog,
    getAll: getAll
  };
})();
