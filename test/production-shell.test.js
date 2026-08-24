const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

for (const file of ['deploy-production-runtime.sh', 'live-cognito-probe.sh']) {
  test(`${file} has valid bash syntax`, () => {
    const script = path.join(__dirname, '..', 'scripts', file);
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
