/**
 * Application bootstrap
 * Wires search, tabs, Voice Access, and server-backed session sharing.
 * Opening a shared session URL restores and renders the stored plan.
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

  function runPlace(location) {
    window.SozoRockVoice.handle(location);
  }

  function initSearch() {
    document.getElementById("searchBtn").addEventListener("click", function () {
      var query = document.getElementById("placeInput").value.trim();
      if (query) runPlace(query);
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
      window.SozoRockVoice.listen();
    });
  }

  function initSession() {
    window.SozoRockSession.initFromUrl().then(function (session) {
      if (!session) return;

      document.getElementById("sessionStatus").textContent = "Live session: " + session.id;

      // Restore stored plan into the visual layer
      if (session.plan && window.SozoRockPlace && window.SozoRockPlace.renderFromServer) {
        window.SozoRockPlace.renderFromServer(session.plan, session.cbcapPlan || null);
        if (session.location) {
          var input = document.getElementById("placeInput");
          if (input) input.value = session.location;
        }
      }
    });

    var shareBtn = document.getElementById("shareSessionBtn");
    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        var id = window.SozoRockSession.getCurrentId();
        if (!id) {
          window.SozoRockSession.create(null, null).then(function (session) {
            copyShare(session.id);
          });
        } else {
          copyShare(id);
        }
      });
    }
  }

  function copyShare(id) {
    var url = window.SozoRockSession.shareUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(function () {
      document.getElementById("sessionStatus").textContent = "Link copied — " + id;
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    initSearch();
    initVoice();
    initSession();
  });
})();
