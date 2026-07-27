/**
 * Application bootstrap
 * Wires search, tabs, Voice Access, session sharing, and audit rendering.
 */

(function () {
  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".tab-btn").forEach(function (b) {
          b.classList.remove("border-teal-700", "text-teal-800");
          b.classList.add("border-transparent", "text-slate-500");
        });
        btn.classList.add("border-teal-700", "text-teal-800");
        btn.classList.remove("border-transparent", "text-slate-500");

        document.querySelectorAll(".tab-panel").forEach(function (p) {
          p.classList.add("hidden");
        });
        document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");

        if (btn.dataset.tab === "map" && window.map) {
          setTimeout(function () { window.map.invalidateSize(); }, 80);
        }
      });
    });
  }

  function initSearch() {
    document.getElementById("searchBtn").addEventListener("click", function () {
      var query = document.getElementById("placeInput").value;
      window.SozoRockVoice.runPipeline(query, "search:" + query);
    });
  }

  function initVoice() {
    window.SozoRockVoice.init();

    document.getElementById("sendVoice").addEventListener("click", function () {
      var input = document.getElementById("voiceInput");
      if (input.value.trim()) {
        window.SozoRockVoice.handle(input.value.trim());
        input.value = "";
      }
    });

    document.getElementById("voiceInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        document.getElementById("sendVoice").click();
      }
    });

    document.getElementById("micBtn").addEventListener("click", function () {
      window.SozoRockVoice.simulateListen();
    });
  }

  function initSession() {
    // Resume session from URL if present
    var params = new URLSearchParams(window.location.search);
    var sessionId = params.get("session");
    if (sessionId) {
      var existing = window.SozoRockSession.get(sessionId);
      if (existing) {
        window.SozoRockSession.setCurrent(sessionId);
        document.getElementById("sessionStatus").textContent = "Live session: " + sessionId;
      }
    }

    var shareBtn = document.getElementById("shareSessionBtn");
    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        var session = window.SozoRockSession.getCurrent();
        if (!session) {
          session = window.SozoRockSession.create("New plan");
          window.SozoRockSession.setCurrent(session.id);
        }
        var url = window.SozoRockSession.shareUrl();
        navigator.clipboard.writeText(url).then(function () {
          document.getElementById("sessionStatus").textContent = "Link copied — " + session.id;
        });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    initSearch();
    initVoice();
    initSession();
    window.SozoRockAudit.renderLog();
  });
})();
