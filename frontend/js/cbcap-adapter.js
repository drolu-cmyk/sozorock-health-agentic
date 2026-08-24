/**
 * Governed CB-CAP browser adapter.
 *
 * This client contains no county fixtures, modeled reach, planning scores,
 * hub mixes, demo heat points, or persisted access tokens. Production surfaces
 * inject a short-lived access-token provider backed by their authenticated
 * workspace session. The explicit unauthenticated server mode remains dev-only.
 */

window.SozoRockCBCAP = (function () {
  var accessTokenProvider = null;

  function configure(options) {
    var config = options || {};
    if (Object.prototype.hasOwnProperty.call(config, 'accessToken')) {
      throw new Error('Do not configure CB-CAP with a stored access token. Provide getAccessToken instead.');
    }
    if (config.getAccessToken !== undefined && typeof config.getAccessToken !== 'function') {
      throw new Error('getAccessToken must be a function.');
    }
    accessTokenProvider = config.getAccessToken || null;
  }

  async function authorizationHeaders() {
    var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!accessTokenProvider) return headers;
    var token = String(await accessTokenProvider() || '').trim();
    if (!token || token.length > 8192 || /\s/.test(token)) {
      throw new Error('The authenticated CB-CAP session is unavailable.');
    }
    headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  async function post(path, payload, acceptedStatuses) {
    var response = await fetch(path, {
      method: 'POST',
      headers: await authorizationHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    var body = await response.json().catch(function () {
      return { error: 'CB-CAP returned an unreadable response.' };
    });
    if (!response.ok && acceptedStatuses.indexOf(response.status) === -1) {
      throw new Error(typeof body.error === 'string' ? body.error : 'CB-CAP request failed.');
    }
    return body;
  }

  async function fetchSignals(location, options) {
    var request = options || {};
    var payload = { location: String(location || '').trim() };
    if (!payload.location) throw new Error('A county or geography is required.');
    if (request.assumptions) payload.assumptions = request.assumptions;
    return post('/api/cbcap', payload, [202, 409]);
  }

  async function reviewRun(runId, decision) {
    var id = String(runId || '').trim();
    if (!id || id.length > 128) throw new Error('A valid CB-CAP run ID is required.');
    if (decision !== 'approve') throw new Error('The only supported review decision is approve.');
    return post('/api/cbcap/runs/' + encodeURIComponent(id) + '/review', { decision: 'approve' }, []);
  }

  return {
    configure: configure,
    fetchSignals: fetchSignals,
    reviewRun: reviewRun
  };
})();
