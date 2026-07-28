/**
 * Server-side Place Intelligence API
 *
 * Single entry point for all experiences.
 * Uses Chief of Staff + sub-agents.
 * Emits server-side audit events with data minimization.
 *
 * Can be mounted under Express, API Gateway + Lambda, or any HTTP runtime.
 */

const { ChiefOfStaff } = require("../packages/agents/chief-of-staff");

function createPlaceIntelligenceAPI(options = {}) {
  const auditLog = [];

  const chief = new ChiefOfStaff({
    auditSink: (event) => {
      // Data minimization: store only necessary fields
      auditLog.push({
        id: "aud_" + Date.now().toString(36),
        action: event.action,
        fips: event.fips || null,
        purpose: event.purpose || null,
        at: new Date().toISOString(),
        durationMs: event.durationMs || null
      });
      if (options.onAudit) options.onAudit(event);
    }
  });

  /**
   * Handle a place intelligence request.
   * @param {object} body
   * @param {string} body.location
   * @param {string} [body.purpose] - resident | planner | funder | cbcap
   */
  async function handle(body) {
    if (!body || !body.location) {
      return {
        statusCode: 400,
        body: { error: "location is required" }
      };
    }

    const purpose = body.purpose || "resident";
    const result = await chief.runPlaceIntelligence({
      locationQuery: body.location,
      purpose
    });

    if (result.status === "error") {
      return {
        statusCode: 422,
        body: result
      };
    }

    return {
      statusCode: 200,
      body: result
    };
  }

  function getAuditLog() {
    // Governance console only
    return [...auditLog];
  }

  return {
    handle,
    getAuditLog
  };
}

module.exports = { createPlaceIntelligenceAPI };
