/**
 * Place Analysis Agent
 *
 * Accepts a location identifier and returns a structured place intelligence
 * package suitable for both human interfaces and downstream agents.
 *
 * This module is intentionally free of UI concerns. It can be invoked from
 * the frontend, an API route, a Lambda, or another agent.
 */

class PlaceAgent {
  /**
   * @param {object} options
   * @param {Function} options.resolvePlace - function that returns place data
   */
  constructor(options = {}) {
    this.resolvePlace = options.resolvePlace || (() => null);
  }

  /**
   * Run place analysis.
   * @param {string} locationQuery
   * @returns {Promise<object>} structured result
   */
  async analyze(locationQuery) {
    const place = this.resolvePlace(locationQuery);

    if (!place) {
      return {
        status: "not_found",
        message: "No public data available for the requested location.",
        locationQuery
      };
    }

    return {
      status: "ok",
      location: {
        name: place.name,
        fips: place.fips || null,
        coordinates: { lat: place.lat, lng: place.lng }
      },
      brief: {
        planStatus: place.status,
        context: place.context,
        gaps: place.gaps
      },
      barriers: place.barriers,
      actions: place.actions,
      hubs: place.hubs,
      accessDay: place.accessDay,
      meta: {
        nonClinical: true,
        sourceTraceable: true,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

module.exports = { PlaceAgent };
