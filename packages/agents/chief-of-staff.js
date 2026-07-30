/**
 * Chief of Staff Agent
 *
 * Single entry point for orchestrated place intelligence.
 */

const { GeographyAgent } = require("./sub-agents/geography-agent");
const { ResearchAgent } = require("./sub-agents/research-agent");
const { BarrierAgent } = require("./sub-agents/barrier-agent");
const { HubMatchingAgent } = require("./sub-agents/hub-matching-agent");
const { ReportAgent } = require("./sub-agents/report-agent");
const { ComplianceAgent } = require("./sub-agents/compliance-agent");

class ChiefOfStaff {
  constructor(options = {}) {
    this.geography = new GeographyAgent();
    this.research = new ResearchAgent();
    this.barrier = new BarrierAgent();
    this.hub = new HubMatchingAgent();
    this.report = new ReportAgent();
    this.compliance = new ComplianceAgent();
    this.auditSink = options.auditSink || (() => {});
  }

  async runPlaceIntelligence(task) {
    const start = Date.now();
    const trace = [];

    const geo = await this.geography.resolve(task.locationQuery);
    trace.push({ agent: "geography", status: geo ? (geo.status || "ok") : "failed" });

    if (!geo) {
      return this._fail("Unable to resolve location to a U.S. county", trace);
    }

    if (geo.status === "ambiguous") {
      return {
        status: "ambiguous",
        message: geo.message,
        matches: geo.matches,
        meta: {
          nonClinical: true,
          generatedAt: new Date().toISOString(),
          trace
        }
      };
    }

    const evidence = await this.research.gather(geo.fips);
    trace.push({
      agent: "research",
      status: evidence.dataNature === "none" ? "no_data" : "ok",
      sources: (evidence.sources || []).length
    });

    // Fail closed when geography resolved but no source-backed indicators
    if (evidence.dataNature === "none" || !(evidence.sources || []).length) {
      this.auditSink({
        action: "place_intelligence_no_data",
        fips: geo.fips,
        purpose: task.purpose
      });
      return {
        status: "error",
        message:
          "Geography resolved (" +
          (geo.county || geo.fips) +
          ", " +
          (geo.state || "") +
          ") but no source-backed county indicators are loaded. " +
          "Add ACS/PLACES snapshot rows or live adapter coverage for this FIPS.",
        location: {
          query: task.locationQuery,
          fips: geo.fips,
          county: geo.county,
          state: geo.state,
          lat: geo.lat,
          lng: geo.lng
        },
        meta: {
          nonClinical: true,
          sourceTraceable: false,
          dataNature: "none",
          generatedAt: new Date().toISOString(),
          agentVersion: "0.5.1",
          trace
        }
      };
    }

    const barriers = this.barrier.score(evidence.indicators);
    trace.push({ agent: "barrier", status: "ok", composite: barriers.composite });

    const hubs = this.hub.match(barriers.scores, geo);
    trace.push({ agent: "hub-matching", status: "ok" });

    let package_ = {
      location: {
        query: task.locationQuery,
        fips: geo.fips,
        county: geo.county,
        state: geo.state,
        zcta: geo.zcta || null,
        lat: geo.lat || null,
        lng: geo.lng || null
      },
      brief: {
        planStatus: evidence.planStatus,
        context: evidence.context,
        gaps: evidence.gaps
      },
      barriers: barriers.scores,
      barrierMethodology: barriers.methodology,
      compositeBarrier: barriers.composite,
      hubs,
      evidence: {
        sources: evidence.sources,
        freshness: evidence.freshness,
        lineages: evidence.lineages || []
      },
      actions: this._defaultActions(hubs),
      meta: {
        nonClinical: true,
        sourceTraceable: true,
        sourceFreshness: evidence.freshness,
        purpose: task.purpose || "resident",
        dataNature: evidence.dataNature,
        generatedAt: new Date().toISOString(),
        agentVersion: "0.5.1",
        durationMs: Date.now() - start
      }
    };

    if (task.purpose === "planner" || task.purpose === "funder" || task.purpose === "cbcap") {
      package_.report = this.report.generate(package_, task.purpose);
      trace.push({ agent: "report", status: "ok" });
    }

    const compliance = this.compliance.check(package_);
    trace.push({ agent: "compliance", status: compliance.ok ? "ok" : "blocked" });

    if (!compliance.ok) {
      this.auditSink({
        action: "place_intelligence_blocked",
        reason: compliance.violations,
        location: geo.fips
      });
      return this._fail("Policy violation: " + compliance.violations.join("; "), trace);
    }

    this.auditSink({
      action: "place_intelligence_completed",
      fips: geo.fips,
      purpose: task.purpose,
      durationMs: Date.now() - start,
      trace
    });

    package_.meta.trace = trace;
    package_.meta.durationMs = Date.now() - start;
    return package_;
  }

  _defaultActions(hubs) {
    return (hubs || []).slice(0, 3).map(h => ({
      title: h.type + " Health Equity Hub",
      fit: h.fit,
      reason: h.reason,
      measure: "Activation readiness and resident connection rate"
    }));
  }

  _fail(message, trace) {
    return {
      status: "error",
      message,
      meta: {
        nonClinical: true,
        generatedAt: new Date().toISOString(),
        trace
      }
    };
  }
}

module.exports = { ChiefOfStaff };
