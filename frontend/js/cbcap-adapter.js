/**
 * Governed CB-CAP browser adapter.
 *
 * This client contains no county fixtures, modeled reach, planning scores,
 * hub mixes, or demo heat points. All CB-CAP output comes from the governed
 * server graph, which in turn consumes the reviewed Evidence Gateway.
 */

window.SozoRockCBCAP = (function () {
  async function fetchSignals(location, options) {
    var request = options || {};
    var payload = { location: String(location || '').trim() };
    if (!payload.location) throw new Error('A county or geography is required.');
    if (request.assumptions) payload.assumptions = request.assumptions;
    if (request.approval) payload.approval = request.approval;

    var response = await fetch('/api/cbcap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    var body = await response.json().catch(function () {
      return { error: 'CB-CAP returned an unreadable response.' };
    });

    if (!response.ok && response.status !== 202 && response.status !== 409) {
      throw new Error(body.error || (body.error && body.error.reason) || 'CB-CAP request failed.');
    }
    return body;
  }

  return {
    fetchSignals: fetchSignals
  };
})();
