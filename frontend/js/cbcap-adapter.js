/**
 * CB-CAP Data Adapter
 *
 * Translates county-level public evidence into planning signals that Explore
 * and agents can consume. Structured so a live CB-CAP endpoint can replace
 * the local resolver without changing callers.
 *
 * Contract mirrors the County Data Contract in src/data/county-contract.js
 */

window.SozoRockCBCAP = (function () {
  // Simulated county signals derived from public-style estimates.
  // In production this becomes an HTTP call to cbcap.sozorockfoundation.org
  // or an internal service that normalizes CDC PLACES + local configuration.
  var countySignals = {
    "36095": { // Schoharie County
      fips: "36095",
      name: "Schoharie County, NY",
      planningAttention: 68,
      chronicPressure: 61,
      barrierPressure: 72,
      preventionOpportunity: 55,
      recommendedHubMix: { Library: 0.45, Community: 0.25, Home: 0.30 },
      scenarios: [
        {
          id: "sc_lib",
          name: "Library-first",
          description: "Primary investment in Library Health Equity Hub with supporting Access Day",
          projectedReach: 420,
          barrierReduction: 18,
          costIndex: 1.0
        },
        {
          id: "sc_home",
          name: "Home + Library",
          description: "Home tablet pathway for high-transportation barriers plus Library hub",
          projectedReach: 510,
          barrierReduction: 24,
          costIndex: 1.35
        },
        {
          id: "sc_balanced",
          name: "Balanced three-hub",
          description: "Proportional Library, Community, and Home activation",
          projectedReach: 580,
          barrierReduction: 27,
          costIndex: 1.55
        }
      ],
      heatPoints: [
        { lat: 42.68, lng: -74.49, intensity: 0.85 },
        { lat: 42.71, lng: -74.42, intensity: 0.6 },
        { lat: 42.64, lng: -74.55, intensity: 0.7 },
        { lat: 42.75, lng: -74.38, intensity: 0.45 }
      ]
    },
    "default": {
      fips: null,
      name: "County (public estimates)",
      planningAttention: 45,
      chronicPressure: 40,
      barrierPressure: 42,
      preventionOpportunity: 38,
      recommendedHubMix: { Library: 0.4, Community: 0.35, Home: 0.25 },
      scenarios: [
        {
          id: "sc_default",
          name: "Baseline review",
          description: "Standard place intelligence review and hub assessment",
          projectedReach: 200,
          barrierReduction: 12,
          costIndex: 1.0
        }
      ],
      heatPoints: []
    }
  };

  function fetchSignals(fipsOrQuery) {
    // Production: return fetch(`/api/cbcap?fips=${fips}`).then(r => r.json())
    var key = (fipsOrQuery || "").toString();
    if (key.indexOf("36095") !== -1 || key.toLowerCase().indexOf("schoharie") !== -1 || key.indexOf("12043") !== -1) {
      return Promise.resolve(countySignals["36095"]);
    }
    return Promise.resolve(Object.assign({}, countySignals["default"], { name: fipsOrQuery || "Selected county" }));
  }

  return {
    fetchSignals: fetchSignals
  };
})();
