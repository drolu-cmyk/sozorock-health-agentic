/**
 * Example API handler
 *
 * Demonstrates how an external agent or frontend can request place intelligence.
 * Can be adapted for API Gateway + Lambda, Express, or any HTTP runtime.
 *
 * Expected request: GET /place?q=12043  or  POST { "location": "12043" }
 */

const { PlaceAgent } = require("../src/agents/place-agent");
const { HubMatcher } = require("../src/agents/hub-matcher");

// In a real deployment the resolvePlace function would call public data adapters.
function createHandler(resolvePlace) {
  const placeAgent = new PlaceAgent({ resolvePlace });
  const hubMatcher = new HubMatcher();

  return async function handler(event) {
    const query =
      (event.queryStringParameters && event.queryStringParameters.q) ||
      (event.body && JSON.parse(event.body).location) ||
      null;

    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "location query required" })
      };
    }

    const analysis = await placeAgent.analyze(query);

    if (analysis.status !== "ok") {
      return {
        statusCode: 404,
        body: JSON.stringify(analysis)
      };
    }

    // Enrich with hub matching
    analysis.hubRanking = hubMatcher.match(analysis.barriers);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(analysis)
    };
  };
}

module.exports = { createHandler };
