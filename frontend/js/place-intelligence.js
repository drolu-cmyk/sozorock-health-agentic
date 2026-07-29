/**
 * Place Intelligence rendering layer
 *
 * Accepts the server Place Intelligence Package produced by Chief of Staff.
 * Also accepts an optional CB-CAP plan for scenarios and hub mix.
 */

window.SozoRockPlace = (function () {
  var mapInstance = null;
  var barrierChart = null;
  var trendChart = null;

  var COUNTY_CENTERS = {
    "36095": { lat: 42.68, lng: -74.49 },
    "36025": { lat: 42.20, lng: -75.00 }
  };

  function resolveCoordinates(pkg) {
    if (pkg.location && typeof pkg.location.lat === "number" && typeof pkg.location.lng === "number") {
      return { lat: pkg.location.lat, lng: pkg.location.lng };
    }
    var fips = pkg.location && pkg.location.fips;
    if (fips && COUNTY_CENTERS[fips]) {
      return COUNTY_CENTERS[fips];
    }
    return { lat: 39.8, lng: -98.5, zoom: 4 };
  }

  function renderFromServer(pkg, cbcapPlan) {
    if (!pkg || pkg.status === "error") {
      console.warn("Place intelligence error", pkg && pkg.message);
      return;
    }

    var name = (pkg.location && (pkg.location.county
      ? pkg.location.county + " County, " + (pkg.location.state || "")
      : pkg.location.query)) || "Selected place";

    var coords = resolveCoordinates(pkg);

    var view = {
      name: name,
      lat: coords.lat,
      lng: coords.lng,
      zoom: coords.zoom || 9,
      status: (pkg.brief && pkg.brief.planStatus) || "Plan status available for local review",
      context: (pkg.brief && pkg.brief.context) || "",
      gaps: (pkg.brief && pkg.brief.gaps) || [],
      barriers: pkg.barriers || {},
      compositeBarrier: pkg.compositeBarrier,
      barrierMethodology: pkg.barrierMethodology,
      hubs: (pkg.hubs || []).map(function (h) {
        return { type: h.type, fit: h.fit, reason: h.reason || "", score: h.score };
      }),
      actions: (pkg.actions || []).map(function (a) {
        return {
          title: a.title || a.type || "Recommended action",
          desc: a.reason || a.description || "",
          partner: a.partner || "Local partner to confirm",
          measure: a.measure || "Activation readiness"
        };
      }),
      evidence: pkg.evidence || { sources: [], freshness: null },
      report: pkg.report || null,
      meta: pkg.meta || {},
      accessDay: "Health Access Day can be scheduled once hub format and partners are confirmed."
    };

    render(view, cbcapPlan || null);
  }

  function render(data, cbcap) {
    document.getElementById("results").classList.remove("hidden");
    document.getElementById("hubs").classList.remove("hidden");
    document.getElementById("accessDay").classList.remove("hidden");
    document.getElementById("scenarios").classList.remove("hidden");
    document.getElementById("funderView").classList.remove("hidden");

    document.getElementById("placeName").textContent = data.name || "\u2014";
    document.getElementById("briefStatus").textContent = data.status || "";
    document.getElementById("briefContext").textContent = data.context || "";

    var gapsHtml = (data.gaps || []).map(function (g) {
      return "<li>" + escapeHtml(g) + "</li>";
    }).join("");

    if (data.evidence && data.evidence.sources && data.evidence.sources.length) {
      gapsHtml += "<li class='mt-2 list-none text-xs text-slate-500'><strong>Sources</strong> (freshness: " +
        escapeHtml(data.evidence.freshness || "n/a") + ")</li>";
      data.evidence.sources.forEach(function (s) {
        gapsHtml += "<li class='list-none text-xs text-slate-500'>\u00b7 " +
          escapeHtml(s.citation || s.title || "Source") +
          (s.releaseDate ? " (" + escapeHtml(s.releaseDate) + ")" : "") +
          "</li>";
      });
    }

    document.getElementById("briefGaps").innerHTML = gapsHtml || "<li>No gaps listed</li>";

    var actionList = document.getElementById("actionList");
    actionList.innerHTML = (data.actions || []).map(function (a) {
      return (
        '<div class="bg-white rounded-lg border border-slate-200 p-4">' +
        '<div class="font-medium text-sm text-slate-900">' + escapeHtml(a.title) + '</div>' +
        '<p class="text-sm text-slate-600 mt-1">' + escapeHtml(a.desc) + '</p>' +
        '<div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">' +
        '<span>Partner: ' + escapeHtml(a.partner) + '</span>' +
        '<span>Measure: ' + escapeHtml(a.measure) + '</span>' +
        '</div></div>'
      );
    }).join("") || '<p class="text-sm text-slate-500">No actions generated.</p>';

    var hubCards = document.getElementById("hubCards");
    hubCards.innerHTML = (data.hubs || []).map(function (h) {
      var fitClass = h.fit === "High" ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600";
      return (
        '<div class="hub-card bg-white rounded-lg border border-slate-200 p-4">' +
        '<div class="flex items-center justify-between mb-1.5">' +
        '<h3 class="text-sm font-semibold text-slate-900">' + escapeHtml(h.type) + ' Health Equity Hub</h3>' +
        '<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ' + fitClass + '">' + escapeHtml(h.fit) + ' fit</span>' +
        '</div>' +
        '<p class="text-sm text-slate-600">' + escapeHtml(h.reason) + '</p></div>'
      );
    }).join("") || '<p class="text-sm text-slate-500">No hub ranking available.</p>';

    document.getElementById("accessDayText").textContent = data.accessDay || "";

    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
    var mapEl = document.getElementById("map");
    if (mapEl) {
      var zoom = data.zoom || 9;
      mapInstance = L.map("map").setView([data.lat, data.lng], zoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "\u00a9 OpenStreetMap"
      }).addTo(mapInstance);
      L.marker([data.lat, data.lng]).addTo(mapInstance).bindPopup(escapeHtml(data.name)).openPopup();

      if (cbcap && cbcap.heatPoints && cbcap.heatPoints.length) {
        cbcap.heatPoints.forEach(function (pt) {
          var radius = 18 + ((pt.intensity || 0.5) * 28);
          var opacity = 0.25 + ((pt.intensity || 0.5) * 0.45);
          L.circleMarker([pt.lat, pt.lng], {
            radius: radius,
            color: "#0f766e",
            fillColor: "#0d9488",
            fillOpacity: opacity,
            weight: 1
          }).addTo(mapInstance);
        });
      }
    }

    if (barrierChart) barrierChart.destroy();
    if (trendChart) trendChart.destroy();

    var barrierCtx = document.getElementById("barrierChart");
    if (barrierCtx) {
      barrierChart = new Chart(barrierCtx.getContext("2d"), {
        type: "bar",
        data: {
          labels: Object.keys(data.barriers || {}),
          datasets: [{ data: Object.values(data.barriers || {}), backgroundColor: "#0f766e" }]
        },
        options: {
          indexAxis: "y",
          scales: { x: { beginAtZero: true, max: 100 } },
          plugins: { legend: { display: false } }
        }
      });
    }

    var trendCtx = document.getElementById("trendChart");
    if (trendCtx) {
      var composite = data.compositeBarrier != null ? [null, null, null, null, null, data.compositeBarrier] : [];
      trendChart = new Chart(trendCtx.getContext("2d"), {
        type: "line",
        data: {
          labels: ["2019", "2020", "2021", "2022", "2023", "Current"],
          datasets: [{
            data: composite,
            borderColor: "#0f766e",
            tension: 0.3,
            fill: false,
            spanGaps: true
          }]
        },
        options: {
          scales: { y: { beginAtZero: true, max: 100 } },
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: "Current composite only (historical series pending live adapters)",
              font: { size: 10 }
            }
          }
        }
      });
    }

    renderScenarios(cbcap);
    renderFunderView(data, cbcap);
  }

  function renderScenarios(cbcap) {
    var el = document.getElementById("scenarioTable");
    if (!el) return;

    var scenarios = (cbcap && cbcap.scenarios) || null;

    if (!scenarios || !scenarios.length) {
      el.innerHTML = "<tr><td class='text-sm text-slate-500 p-3' colspan='4'>No scenarios available for this place yet.</td></tr>";
      return;
    }

    el.innerHTML = scenarios.map(function (s) {
      var reach = s.projectedReach;
      var reduction = s.barrierReduction;
      if (reach && typeof reach === "object") reach = reach.value + " (modeled)";
      if (reduction && typeof reduction === "object") reduction = reduction.value + "% (modeled)";
      else if (typeof reduction === "number") reduction = reduction + "%";

      return (
        "<tr class='border-t border-slate-100'>" +
        "<td class='p-3 text-sm font-medium text-slate-900'>" + escapeHtml(s.name) + "</td>" +
        "<td class='p-3 text-sm text-slate-600'>" + escapeHtml(s.description || "") + "</td>" +
        "<td class='p-3 text-sm text-slate-700'>" + escapeHtml(String(reach)) + "</td>" +
        "<td class='p-3 text-sm text-slate-700'>" + escapeHtml(String(reduction)) + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderFunderView(data, cbcap) {
    var reachEl = document.getElementById("funderReach");
    var mixEl = document.getElementById("funderHubMix");
    var barrierEl = document.getElementById("funderBarrier");
    if (!reachEl) return;

    if (cbcap && cbcap.scenarios && cbcap.scenarios[0]) {
      var top = cbcap.scenarios[0];
      var r = top.projectedReach;
      reachEl.textContent = (typeof r === "object" ? r.value : r) + " residents (top modeled scenario)";
    } else if (data.report && data.report.reachPotential) {
      reachEl.textContent = data.report.reachPotential + " (modeled)";
    } else {
      reachEl.textContent = "\u2014";
    }

    if (cbcap && cbcap.recommendedHubMix) {
      mixEl.textContent = Object.keys(cbcap.recommendedHubMix).map(function (k) {
        return k + ": " + Math.round(cbcap.recommendedHubMix[k] * 100) + "%";
      }).join(" \u00b7 ");
    } else if (data.hubs && data.hubs.length) {
      mixEl.textContent = data.hubs.map(function (h) { return h.type + " (" + h.fit + ")"; }).join(" \u00b7 ");
    } else {
      mixEl.textContent = "\u2014";
    }

    if (data.compositeBarrier != null) {
      barrierEl.textContent = data.compositeBarrier + " / 100 composite pressure";
    } else {
      barrierEl.textContent = "\u2014";
    }
  }

  function escapeHtml(str) {
    if (str == null) return "";
    var amp = "&" + "amp;";
    var lt = "&" + "lt;";
    var gt = "&" + "gt;";
    var quot = "&" + "quot;";
    var apos = "&" + "#39;";
    return String(str)
      .replace(/&/g, amp)
      .replace(/</g, lt)
      .replace(/>/g, gt)
      .replace(/"/g, quot)
      .replace(/'/g, apos);
  }

  return {
    render: render,
    renderFromServer: renderFromServer
  };
})();
