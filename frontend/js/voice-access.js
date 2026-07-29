/**
 * Voice Access
 *
 * Uses browser Web Speech API when available.
 * Sends location to POST /api/place and POST /api/cbcap,
 * then renders the combined result via renderFromServer.
 * Stores both packages in the shared session so a second browser can restore them.
 */

window.SozoRockVoice = (function () {
  var chatLog = null;
  var recognition = null;
  var isListening = false;

  function init() {
    chatLog = document.getElementById("chatLog");
    addSystem("Speak or type a ZIP or county. Currently full plans are available for Schoharie and Delaware Counties, NY. Other locations return a clear resolution failure.");

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = function (event) {
        var transcript = event.results[0][0].transcript;
        stopListeningUI();
        handle(transcript);
      };

      recognition.onerror = function () {
        stopListeningUI();
        addSystem("I could not hear clearly. You can type instead.");
      };

      recognition.onend = function () {
        stopListeningUI();
      };
    }
  }

  function addSystem(text) {
    var div = document.createElement("div");
    div.className = "chat-bubble bg-teal-50 text-teal-900 px-3.5 py-2 rounded-2xl rounded-tl-sm";
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addUser(text) {
    var div = document.createElement("div");
    div.className = "chat-bubble bg-slate-200 text-slate-800 px-3.5 py-2 rounded-2xl rounded-tr-sm ml-auto";
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function extractLocation(text) {
    var zipMatch = text.match(/\b\d{5}\b/);
    if (zipMatch) return zipMatch[0];
    var lower = text.toLowerCase();
    if (lower.indexOf("cobleskill") !== -1 || lower.indexOf("schoharie") !== -1) return "12043";
    if (lower.indexOf("delaware") !== -1) return "13753";
    return text.trim() || null;
  }

  function handle(text) {
    addUser(text);
    addSystem("Retrieving place intelligence and planning signals…");

    var location = extractLocation(text) || (document.getElementById("placeInput") && document.getElementById("placeInput").value) || "12043";

    Promise.all([
      fetch("/api/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: location, purpose: "resident" })
      }).then(function (r) { return r.json(); }),
      fetch("/api/cbcap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: location })
      }).then(function (r) { return r.json(); }).catch(function () { return null; })
    ])
      .then(function (results) {
        var data = results[0];
        var cbcap = results[1];

        if (data.status === "error") {
          addSystem(data.message || "I could not complete that request for this location.");
          return;
        }

        return fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: location,
            plan: data,
            cbcapPlan: cbcap
          })
        })
          .then(function (r) { return r.json(); })
          .then(function (session) {
            if (window.SozoRockSession) {
              window.SozoRockSession.setCurrent(session.id);
            }

            if (window.SozoRockPlace && window.SozoRockPlace.renderFromServer) {
              window.SozoRockPlace.renderFromServer(data, cbcap);
            }

            var countyLabel = (data.location && data.location.county)
              ? data.location.county + " County"
              : location;
            addSystem("Place intelligence ready for " + countyLabel + ". Sources and release dates are listed in the Brief.");

            var input = document.getElementById("placeInput");
            if (input) input.value = location;
            var resultsEl = document.getElementById("results");
            if (resultsEl) resultsEl.scrollIntoView({ behavior: "smooth" });
          });
      })
      .catch(function (err) {
        console.error(err);
        addSystem("The place intelligence service is not reachable. Start the server with npm start.");
      });
  }

  function startListening() {
    if (!recognition) {
      addSystem("Speech recognition is not available in this browser. Please type your request.");
      return;
    }
    if (isListening) return;

    isListening = true;
    var btn = document.getElementById("micBtn");
    if (btn) btn.classList.add("voice-pulse", "text-teal-700");
    addSystem("Listening…");
    try {
      recognition.start();
    } catch (e) {
      stopListeningUI();
      addSystem("Could not start the microphone. Please type instead.");
    }
  }

  function stopListeningUI() {
    isListening = false;
    var btn = document.getElementById("micBtn");
    if (btn) btn.classList.remove("voice-pulse", "text-teal-700");
  }

  function listen() {
    startListening();
  }

  return {
    init: init,
    handle: handle,
    listen: listen,
    simulateListen: listen
  };
})();
