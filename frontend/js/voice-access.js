/**
 * Voice Access
 *
 * Uses the browser Web Speech API when available.
 * Recognized (or typed) text is sent to the real server POST /api/place.
 * Falls back to typed input if speech recognition is unavailable.
 */

window.SozoRockVoice = (function () {
  var chatLog = null;
  var recognition = null;
  var isListening = false;

  function init() {
    chatLog = document.getElementById("chatLog");
    addSystem("You can speak or type. Tell me a ZIP, county, or what is making the next step difficult.");

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
    return null;
  }

  function handle(text) {
    addUser(text);
    if (window.SozoRockAudit) {
      window.SozoRockAudit.record("voice_input", { summary: text.slice(0, 80) }, "resident");
    }

    addSystem("Checking place intelligence…");

    var location = extractLocation(text) || (document.getElementById("placeInput") && document.getElementById("placeInput").value) || "12043";

    // Call the real server API
    fetch("/api/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: location, purpose: "resident" })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.status === "error") {
          addSystem(data.message || "I could not complete that request.");
          return;
        }

        // Create server-side session
        return fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location: location, plan: data })
        })
          .then(function (r) { return r.json(); })
          .then(function (session) {
            if (window.SozoRockSession) {
              window.SozoRockSession.setCurrent(session.id);
            }

            // Render using place-intelligence if available
            if (window.SozoRockPlace && window.SozoRockPlace.renderFromServer) {
              window.SozoRockPlace.renderFromServer(data);
            } else if (window.SozoRockPlace && window.SozoRockPlace.render) {
              window.SozoRockPlace.render(data, null);
            }

            addSystem("Here is the place intelligence for " + (data.location && data.location.county ? data.location.county + " County" : location) + ".");

            var input = document.getElementById("placeInput");
            if (input) input.value = location;
            var results = document.getElementById("results");
            if (results) results.scrollIntoView({ behavior: "smooth" });
          });
      })
      .catch(function (err) {
        console.error(err);
        addSystem("The place intelligence service is not reachable right now. Make sure the server is running (npm start).");
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

  // Keep a named function for the mic button (no longer a simulation)
  function listen() {
    startListening();
  }

  return {
    init: init,
    handle: handle,
    listen: listen,
    // backward-compatible alias
    simulateListen: listen
  };
})();
