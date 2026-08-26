const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { createPlaceIntelligenceAPI } = require('../server/place-intelligence-api');

test('legacy place endpoint is explicitly retired and cannot emit a composite barrier score', async () => {
  const api = createPlaceIntelligenceAPI();
  const result = await api.handle({ location: '36001', purpose: 'resident' });
  assert.equal(result.statusCode, 410);
  assert.equal(result.body.replacement, '/api/cbcap');
  assert.equal(result.body.compositeBarrierScoreAvailable, false);
  assert.equal(Object.hasOwn(result.body, 'compositeBarrier'), false);
});

test('legacy weighted scorer and composite orchestrator are absent from the repository', () => {
  const root = path.join(__dirname, '..');
  for (const relative of [
    'api/example-handler.js',
    'src/agents/orchestrator.js',
    'src/agents/place-agent.js',
    'src/agents/hub-matcher.js',
    'packages/core/barrier-scoring.js',
    'packages/agents/sub-agents/barrier-agent.js',
    'packages/agents/sub-agents/hub-matching-agent.js',
    'packages/agents/sub-agents/report-agent.js',
    'packages/agents/sub-agents/research-agent.js',
    'packages/agents/chief-of-staff.js',
  ]) {
    assert.equal(existsSync(path.join(root, relative)), false, `${relative} must remain retired`);
  }
});
