/**
 * Retired legacy Place Intelligence API.
 *
 * The original prototype produced an unauthenticated weighted composite barrier
 * score. That behavior is intentionally retired. Governed institutional work
 * now enters through /api/cbcap and Barrier Intelligence consumes reviewed
 * Evidence Gateway semantics without a universal score.
 */

function createPlaceIntelligenceAPI(options = {}) {
  const auditLog = [];

  async function handle(body) {
    const event = {
      action: 'legacy_place_intelligence_retired',
      purpose: body?.purpose || null,
      at: new Date().toISOString(),
    };
    auditLog.push(event);
    if (typeof options.onAudit === 'function') options.onAudit(event);
    return {
      statusCode: 410,
      body: {
        error: 'This legacy place-intelligence endpoint has been retired.',
        replacement: '/api/cbcap',
        compositeBarrierScoreAvailable: false,
      },
    };
  }

  function getAuditLog() {
    return auditLog.map((event) => ({ ...event }));
  }

  return { handle, getAuditLog };
}

module.exports = { createPlaceIntelligenceAPI };
