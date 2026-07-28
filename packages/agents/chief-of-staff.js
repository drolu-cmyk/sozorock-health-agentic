/**
 * Chief of Staff Agent
 *
 * Receives a high-level task, selects and sequences approved sub-agents,
 * enforces policy, and returns only structured, non-clinical output.
 *
 * This is the single entry point for orchestrated intelligence.
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

  /**
   * Run a full place intelligence task.
   * @param {object} task
   * @param {string} task.locationQuery - ZIP, county name, or FIPS
   * @param {string} [task.purpose] - "resident" | "planner" | "funder" | "cbcap"
   * @returns {Promise<object>} structured Place Intelligence Package
   */
  async runPlaceIntelligence(task) {
    const start = Date.now();
    const trace = [];

    // 1. Geography resolution (required)
    const geo = await this.geography.resolve(task.locationQuery);
    trace.push({ agent: "geography", status: geo ? "ok" : "failed" });
    if (!geo) {
      return this._fail("Unable to resolve location to a U.S. county", trace);
    }

    // 2. Research / public evidence
    const evidence = await this.research.gather(geo.fips);
    trace.push({ agent: "research", status: "ok", sources: evidence.sources.length });

    // 3. Barrier scoring (deterministic)
    const barriers = this.barrier.score(evidence.indicators);
    trace.push({ agent: "barrier", status: "ok", composite: barriers.composite });

    // 4. Hub matching
    const hubs = this.hub.match(barriers.scores, geo);
    trace.push({ agent: "hub-matching", status: "ok" });

    // 5. Assemble package
    let package_ = {
      location: {
        query: task.locationQuery,
        fips: geo.fips,
        county: geo.county,
        state: geo.state,
        zcta: geo.zcta || null
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
        freshness: evidence.freshness
      },
      actions: this._defaultActions(hubs),
      meta: {
        nonClinical: true,
        sourceTraceable: true,
        sourceFreshness: evidence.freshness,
        purpose: task.purpose || "resident",
        generatedAt: new Date().toISOString(),
        agentVersion: "0.4.0",
        durationMs: Date.now() - start
      }
    };

    // 6. Report layer FIRST (so compliance can inspect it)
    if (task.purpose === "planner" || task.purpose === "funder" || task.purpose === "cbcap") {
      package_.report = this.report.generate(package_, task.purpose);
      trace.push({ agent: "report", status: "ok" });
    }

    // 7. Compliance gate AFTER report (mandatory)
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
      durationMs: package_.meta.durationMs,
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
        sourceTraceable: true,
        generatedAt: new Date().toISOString(),
        trace
      }
    };
  }
}

module.exports = { ChiefOfStaff };
