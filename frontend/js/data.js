/**
 * Place data contracts and demonstration records.
 * In production these are replaced by adapters that pull from public sources
 * covering all 3,144 county equivalents.
 */

window.SozoRockData = {
  places: {
    "12043": {
      name: "Cobleskill, NY (ZIP 12043)",
      lat: 42.6779,
      lng: -74.4854,
      fips: "36095",
      status: "Local CHA/CHIP cycle active. Library Health Equity Hub format under review for partnership.",
      context: "Rural county showing elevated transportation and digital-readiness barriers relative to state median. Public estimates indicate provider shortage pressure.",
      gaps: [
        "Transportation barrier percentile above state median (CDC PLACES 2025)",
        "Digital readiness gap flagged for local review",
        "Workforce capacity signal for community health roles"
      ],
      barriers: {
        Transportation: 72,
        Technology: 58,
        Language: 18,
        Cost: 45,
        Workforce: 65
      },
      trend: [42, 45, 48, 51, 55, 58],
      actions: [
        {
          title: "Library Health Equity Hub",
          desc: "Trusted public starting point with digital readiness support. Fits existing library infrastructure.",
          partner: "Local public library",
          measure: "Digital readiness sessions completed"
        },
        {
          title: "Health Access Day",
          desc: "One-day activation focused on prevention education and connection pathways.",
          partner: "County health + library",
          measure: "Residents reached and next-step completion rate"
        },
        {
          title: "Home tablet pathway",
          desc: "Configured device for residents facing mobility or travel barriers. Voice-first interface.",
          partner: "Community partner",
          measure: "Devices active and successful first connection"
        }
      ],
      hubs: [
        { type: "Library", fit: "High", reason: "Existing public library, trusted location, digital readiness opportunity" },
        { type: "Community", fit: "Medium", reason: "Faith centers and county buildings available for field activation" },
        { type: "Home", fit: "High", reason: "Transportation barrier score elevated; home delivery indicated" }
      ],
      accessDay: "Local evidence supports a prevention-focused Health Access Day in the next planning cycle. Coordinate with library and county health."
    },
    "default": {
      name: "Selected place",
      lat: 42.65,
      lng: -73.75,
      fips: null,
      status: "Public data available. Local plan status requires county-level review.",
      context: "Place-level estimates drawn from public sources. Barriers and chronic-condition signals vary by geography.",
      gaps: [
        "Further local review recommended for pathway breaks",
        "Source freshness check advised"
      ],
      barriers: {
        Transportation: 40,
        Technology: 35,
        Language: 25,
        Cost: 50,
        Workforce: 45
      },
      trend: [30, 32, 35, 38, 40, 42],
      actions: [
        {
          title: "Place intelligence review",
          desc: "Generate full Brief and Action path for local stakeholders.",
          partner: "County planning",
          measure: "Brief shared with owners"
        },
        {
          title: "Hub format assessment",
          desc: "Determine which hub format best matches the barrier mix.",
          partner: "Local partners",
          measure: "Format selected"
        }
      ],
      hubs: [
        { type: "Library", fit: "Medium", reason: "Public library presence to be confirmed" },
        { type: "Community", fit: "Medium", reason: "Neutral community spaces available" },
        { type: "Home", fit: "Medium", reason: "Mobility barriers to be quantified" }
      ],
      accessDay: "Health Access Day can be scheduled once local barrier priorities are confirmed."
    }
  },

  resolve(query) {
    const key = (query || "").trim().toLowerCase();
    if (key.includes("12043") || key.includes("cobleskill")) {
      return this.places["12043"];
    }
    const fallback = Object.assign({}, this.places["default"]);
    fallback.name = query || "Selected place";
    return fallback;
  }
};
