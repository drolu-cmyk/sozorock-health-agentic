const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const adapterPath = path.join(__dirname, '../frontend/js/cbcap-adapter.js');

test('browser CB-CAP adapter uses the governed API and contains no synthetic fixture fields', async () => {
  const source = await readFile(adapterPath, 'utf8');
  assert.match(source, /fetch\('\/api\/cbcap'/);
  assert.match(source, /credentials:\s*'same-origin'/);
  for (const prohibited of [
    'countySignals',
    'planningAttention',
    'projectedReach',
    'barrierReduction',
    'costIndex',
    'recommendedHubMix',
    'heatPoints',
  ]) {
    assert.equal(source.includes(prohibited), false, `${prohibited} must not return to the browser adapter`);
  }
  assert.equal(source.includes('request.approval'), false, 'initial browser request must not submit approval');
});
