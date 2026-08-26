const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const adapterPath = path.join(__dirname, '../frontend/js/cbcap-adapter.js');
const indexPath = path.join(__dirname, '../frontend/index.html');

test('browser CB-CAP adapter uses governed authenticated APIs and contains no synthetic fixture fields', async () => {
  const source = await readFile(adapterPath, 'utf8');
  assert.match(source, /post\('\/api\/cbcap'/);
  assert.match(source, /\/api\/cbcap\/runs\//);
  assert.match(source, /getAccessToken/);
  assert.match(source, /headers\.Authorization = 'Bearer ' \+ token/);
  assert.match(source, /credentials:\s*'same-origin'/);
  assert.equal(source.includes('localStorage'), false, 'adapter must not persist access tokens in localStorage');
  assert.equal(source.includes('sessionStorage'), false, 'adapter must not persist access tokens in sessionStorage');
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

test('served root is an institutional access boundary with no synthetic planning claims', async () => {
  const source = await readFile(indexPath, 'utf8');
  assert.match(source, /authenticated, tenant-scoped planning environment/i);
  assert.match(source, /AI drafts\. People decide\./);
  for (const prohibited of [
    'demonstration coverage',
    'modeled public-style evidence',
    'barrier ranking',
    'composite trend',
    'projected reach',
    'recommended hub mix',
  ]) {
    assert.equal(source.toLowerCase().includes(prohibited), false, `${prohibited} must not be served by the CB-CAP runtime`);
  }
});
