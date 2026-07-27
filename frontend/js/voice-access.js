/**
 * Voice Access conversation handler.
 * Simulates natural turn-taking with pauses and clarification.
 * Production version uses speech recognition and multilingual models
 * while preserving the same interaction contract.
 */

window.SozoRockVoice = (function () {
  var chatLog = null;

  function init() {
    chatLog = document.getElementById("chatLog");
    addSystem("You can speak or type. Tell me what is making the next step difficult.");
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

  function handle(text) {
    addUser(text);

    // Natural pause before clarification
    setTimeout(function () {
      addSystem("I heard you. Let me make sure I understand—what is the main thing making the next step hard right now?");
    }, 700);

    setTimeout(function () {
      var lower = text.toLowerCase();
      if (lower.indexOf("med") !== -1 || lower.indexOf("prescription") !== -1 || lower.indexOf("drug") !== -1 || lower.indexOf("cost") !== -1) {
        addSystem("For medication cost questions I can point you to publicly available pricing tools and then help you find the nearest hub or Access Day. Would you like me to show the place analysis for your area?");
      } else if (lower.indexOf("ride") !== -1 || lower.indexOf("transport") !== -1 || lower.indexOf("get there") !== -1) {
        addSystem("Transportation is a frequent barrier. The Home Health Equity Hub format or a local Library hub may fit. Shall I pull the place intelligence for your ZIP?");
      } else {
        addSystem("Understood. I can show you what the public data says about barriers in your place and which hub format fits best. Enter a ZIP or city above, or tell me the location.");
      }
    }, 2100);
  }

  function simulateListen() {
    var btn = document.getElementById("micBtn");
    btn.classList.add("voice-pulse", "text-teal-700");
    addSystem("Listening…");
    setTimeout(function () {
      btn.classList.remove("voice-pulse", "text-teal-700");
      handle("I need help figuring out where to start and the portal will not open");
    }, 1800);
  }

  return {
    init: init,
    handle: handle,
    simulateListen: simulateListen
  };
})();
