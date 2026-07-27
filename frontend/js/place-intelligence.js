/**
 * Place Intelligence rendering and chart helpers.
 * Responsible for Brief, Map, Action, Visuals, and hub cards.
 */

window.SozoRockPlace = (function () {
  let mapInstance = null;
  let barrierChart = null;
  let trendChart = null;

  function render(data) {
    document.getElementById("results").classList.remove("hidden");
    document.getElementById("hubs").classList.remove("hidden");
    document.getElementById("accessDay").classList.remove("hidden");

    document.getElementById("placeName").textContent = data.name;
    document.getElementById("briefStatus").textContent = data.status;
    document.getElementById("briefContext").textContent = data.context;
    document.getElementById("briefGaps").innerHTML = data.gaps
      .map(function (g) { return "<li>" + g + "</li>"; })
      .join("");

    // Action paths
    var actionList = document.getElementById("actionList");
    actionList.innerHTML = data.actions.map(function (a) {
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
    hubCards.innerHTML = data.hubs.map(function (h) {
      var fitClass = h.fit === "High"
        ? "bg-teal-50 text-teal-800"
        : "bg-slate-100 text-slate-600";
      return (
        '<div class="hub-card bg-white rounded-lg border border-slate-200 p-4">' +
        '<div class="flex items-center justify-between mb-1.5">' +
        '<h3 class="text-sm font-semibold text-slate-900">' + h.type + ' Health Equity Hub</h3>' +
        '<span class="text-[11px] font-medium px-2 py-0.5 rounded-full ' + fitClass + '">' + h.fit + ' fit</span>' +
        '</div>' +
        '<p class="text-sm text-slate-600">' + h.reason + '</p></div>'
      );
    }).join("");

    document.getElementById("accessDayText").textContent = data.accessDay;

    // Map
    if (mapInstance) {
      mapInstance.remove();
    }
    mapInstance = L.map("map").setView([data.lat, data.lng], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap"
    }).addTo(mapInstance);
    L.marker([data.lat, data.lng]).addTo(mapInstance).bindPopup(data.name).openPopup();

    // Charts
    if (barrierChart) barrierChart.destroy();
    if (trendChart) trendChart.destroy();

    var barrierCtx = document.getElementById("barrierChart").getContext("2d");
    barrierChart = new Chart(barrierCtx, {
      type: "bar",
      data: {
        labels: Object.keys(data.barriers),
        datasets: [{
          data: Object.values(data.barriers),
          backgroundColor: "#0f766e"
        }]
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
        datasets: [{
          data: data.trend,
          borderColor: "#0f766e",
          tension: 0.3,
          fill: false
        }]
      },
      options: {
        scales: { y: { beginAtZero: true } },
        plugins: { legend: { display: false } }
      }
    });
  }

  return { render: render };
})();
