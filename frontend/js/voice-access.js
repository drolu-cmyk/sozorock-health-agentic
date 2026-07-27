/**
 * Voice Access
 *
 * Natural conversation front door. A spoken or typed request now runs the
 * full place-analysis pipeline and renders visual results in Explore.
 */

window.SozoRockVoice = (function () {
  var chatLog = null;

  function init() {
    chatLog = document.getElementById("chatLog");
    addSystem("You can speak or type. Tell me what is making the next step difficult, or give me a ZIP or county.");
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
    // Simple extraction for demo. Production uses proper NLU.
    var zipMatch = text.match(/\b\d{5}\b/);
    if (zipMatch) return zipMatch[0];
    var lower = text.toLowerCase();
    if (lower.indexOf("cobleskill") !== -1 || lower.indexOf("schoharie") !== -1) return "12043";
    return null;
  }

  function handle(text) {
    addUser(text);
    window.SozoRockAudit.record("voice_input", { summary: text.slice(0, 80) }, "resident");

    // Natural pause
    setTimeout(function () {
      addSystem("Got it. Checking public place data and planning signals…");
    }, 600);

    var location = extractLocation(text) || document.getElementById("placeInput").value || "12043";

    // Run the full pipeline
    setTimeout(function () {
      runPipeline(location, text);
    }, 1400);
  }

  function runPipeline(location, originalText) {
    // 1. Resolve place data
    var placeData = window.SozoRockData.resolve(location);

    // 2. Pull CB-CAP signals
    window.SozoRockCBCAP.fetchSignals(location).then(function (cbcap) {
      // 3. Policy check
      var package = {
        name: placeData.name,
        lat: placeData.lat,
        lng: placeData.lng,
        status: placeData.status,
        context: placeData.context,
        gaps: placeData.gaps,
        barriers: placeData.barriers,
        trend: placeData.trend,
        actions: placeData.actions,
        hubs: placeData.hubs,
        accessDay: placeData.accessDay,
        meta: {
          nonClinical: true,
          sourceTraceable: true,
          triggeredBy: "voice_access"
        }
      };

      var policy = window.SozoRockAudit.enforcePolicy(package);
      if (!policy.ok) {
        addSystem("I cannot show that result because it violates the non-clinical policy.");
        window.SozoRockAudit.record("policy_block", { violations: policy.violations }, "system");
        return;
      }

      // 4. Create or update shared session
      var session = window.SozoRockSession.getCurrent();
      if (!session) {
        session = window.SozoRockSession.create(placeData.name);
        window.SozoRockSession.setCurrent(session.id);
      }
      window.SozoRockSession.appendEvent("place_analysis", {
        location: location,
        summary: "Place analysis completed for " + placeData.name
      }, "voice-agent");
      window.SozoRockSession.updatePlan({
        actions: placeData.actions,
        hubs: placeData.hubs
      });

      // 5. Render visual results
      window.SozoRockPlace.render(package, cbcap);

      // 6. Audit
      window.SozoRockAudit.record("place_render", {
        summary: "Rendered place intelligence for " + placeData.name,
        location: location
      }, "voice-agent");

      addSystem("Here is the place intelligence for " + placeData.name + ". You can share this live plan with others using the session link.");

      // Update the search box so the visual state is consistent
      document.getElementById("placeInput").value = location;
      document.getElementById("results").scrollIntoView({ behavior: "smooth" });
    });
  }

  function simulateListen() {
    var btn = document.getElementById("micBtn");
    btn.classList.add("voice-pulse", "text-teal-700");
    addSystem("Listening…");
    setTimeout(function () {
      btn.classList.remove("voice-pulse", "text-teal-700");
      handle("I need help in Cobleskill. The portal will not open and I do not have a ride.");
    }, 1600);
  }

  return {
    init: init,
    handle: handle,
    simulateListen: simulateListen,
    runPipeline: runPipeline
  };
})();
