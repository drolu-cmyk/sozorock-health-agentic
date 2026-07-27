/**
 * Place Intelligence rendering layer
 * Renders Brief, Map (with heat), Action, Visuals, Scenarios, and Hub cards.
 * Pulls county planning signals through the CB-CAP adapter.
 */

window.SozoRockPlace = (function () {
  var mapInstance = null;
  var heatLayer = null;
  var barrierChart = null;
  var trendChart = null;

  function render(data, cbcap) {
    document.getElementById("results").classList.remove("hidden");
    document.getElementById("hubs").classList.remove("hidden");
    document.getElementById("accessDay").classList.remove("hidden");
    document.getElementById("scenarios").classList.remove("hidden");
    document.getElementById("funderView").classList.remove("hidden");

    document.getElementById("placeName").textContent = data.name;
    document.getElementById("briefStatus").textContent = data.status;
    document.getElementById("briefContext").textContent = data.context;
    document.getElementById("briefGaps").innerHTML = (data.gaps || [])
      .map(function (g) { return "<li>" + g + "</li>"; })
      .join("");

    // Action paths
    var actionList = document.getElementById("actionList");
    actionList.innerHTML = (data.actions || []).map(function (a) {
      return (
        '<div class="bg-white rounded-lg border border-slate-200 p-4">' +
        '<div class="font-medium text-sm text-slate-900">' + a.title + '</div>' +
        '<p class="text-sm text-slate-600 mt-1">' + a.desc + '</p>' +
        '<div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">' +
        '<span>Partner: ' + a.partner + '</span>' +
        '<span>Measure: ' + a.measure + '</span>' +
        '</div></div>'
      );
    }).join("");

    // Hub cards
    var hubCards = document.getElementById("hubCards");
    hubCards.innerHTML = (data.hubs || []).map(function (h) {
      var fitClass = h.fit === "High" ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600";
      return (
        '<div class="hub-card bg-white rounded-lg border border-slate-200 p-4">' +
        '<div class="flex items-center justify-between mb-1.5">' +
        '<h3 class="text-sm font-semibold text-slate-900">' + h.type + ' Health Equity Hub</h3>' +
        '<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ' + fitClass + '">' + h.fit + ' fit</span>' +
        '</div>' +
        '<p class="text-sm text-slate-600">' + h.reason + '</p></div>'
      );
    }).join("");

    document.getElementById("accessDayText").textContent = data.accessDay || "";

    // Map + heat layer
    if (mapInstance) mapInstance.remove();
    mapInstance = L.map("map").setView([data.lat, data.lng], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "\u00a9 OpenStreetMap"
    }).addTo(mapInstance);
    L.marker([data.lat, data.lng]).addTo(mapInstance).bindPopup(data.name).openPopup();

    // Simple heat visualization using circle markers (no external heat plugin required)
    if (cbcap && cbcap.heatPoints && cbcap.heatPoints.length) {
      cbcap.heatPoints.forEach(function (pt) {
        var radius = 18 + (pt.intensity * 28);
        var opacity = 0.25 + (pt.intensity * 0.45);
        L.circleMarker([pt.lat, pt.lng], {
          radius: radius,
          color: "#0f766e",
          fillColor: "#0d9488",
          fillOpacity: opacity,
          weight: 1
        }).addTo(mapInstance);
      });
    }

    // Charts
    if (barrierChart) barrierChart.destroy();
    if (trendChart) trendChart.destroy();

    var barrierCtx = document.getElementById("barrierChart").getContext("2d");
    barrierChart = new Chart(barrierCtx, {
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

    var trendCtx = document.getElementById("trendChart").getContext("2d");
    trendChart = new Chart(trendCtx, {
      type: "line",
      data: {
        labels: ["2019", "2020", "2021", "2022", "2023", "2024"],
        datasets: [{ data: data.trend || [], borderColor: "#0f766e", tension: 0.3, fill: false }]
      },
      options: {
        scales: { y: { beginAtZero: true } },
        plugins: { legend: { display: false } }
      }
    });

    // Scenario comparison table
    renderScenarios(cbcap);

    // Funder view
    renderFunderView(data, cbcap);
  }

  function renderScenarios(cbcap) {
    var el = document.getElementById("scenarioTable");
    if (!el || !cbcap || !cbcap.scenarios) {
      el.innerHTML = "<tr><td class='text-sm text-slate-500 p-3' colspan='4'>No scenarios available</td></tr>";
      return;
    }
    el.innerHTML = cbcap.scenarios.map(function (s) {
      return (
        "<tr class='border-t border-slate-100'>" +
        "<td class='p-3 text-sm font-medium text-slate-900'>" + s.name + "</td>" +
        "<td class='p-3 text-sm text-slate-600'>" + s.description + "</td>" +
        "<td class='p-3 text-sm text-slate-700'>" + s.projectedReach + "</td>" +
        "<td class='p-3 text-sm text-slate-700'>" + s.barrierReduction + "%</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderFunderView(data, cbcap) {
    var reachEl = document.getElementById("funderReach");
    var mixEl = document.getElementById("funderHubMix");
    var barrierEl = document.getElementById("funderBarrier");

    if (!cbcap) {
      reachEl.textContent = "—";
      mixEl.textContent = "—";
      barrierEl.textContent = "—";
      return;
    }

    var topScenario = (cbcap.scenarios || [])[0];
    reachEl.textContent = topScenario ? topScenario.projectedReach + " residents (top scenario)" : "—";

    if (cbcap.recommendedHubMix) {
      mixEl.innerHTML = Object.keys(cbcap.recommendedHubMix).map(function (k) {
        return k + ": " + Math.round(cbcap.recommendedHubMix[k] * 100) + "%";
      }).join(" · ");
    } else {
      mixEl.textContent = "—";
    }

    barrierEl.textContent = (cbcap.barrierPressure || "—") + " / 100 planning pressure";
  }

  return { render: render };
})();
