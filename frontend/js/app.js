/**
 * Application bootstrap.
 * Wires search, tabs, and Voice Access to the place intelligence layer.
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
      var data = window.SozoRockData.resolve(query);
      window.SozoRockPlace.render(data);
      document.getElementById("results").scrollIntoView({ behavior: "smooth" });
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

  document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    initSearch();
    initVoice();
  });
})();
