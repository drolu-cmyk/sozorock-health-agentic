const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

for (const file of ['deploy-production-runtime.sh', 'live-cognito-probe.sh']) {
  test(`${file} has valid bash syntax`, () => {
    const script = path.join(__dirname, '..', 'scripts', file);
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

test('live Cognito proof uses the deployed production client rather than a temporary client', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'live-cognito-probe.sh'), 'utf8');
  assert.match(script, /USER_POOL_CLIENT_ID/);
  assert.match(script, /cognito-srp-auth\.js/);
  assert.doesNotMatch(script, /create-user-pool-client/);
  assert.doesNotMatch(script, /delete-user-pool-client/);
});

test('deployment script binds the live probe to the stack client and fails closed to zero tasks', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-production-runtime.sh'), 'utf8');
  assert.match(script, /USER_POOL_CLIENT_ID=\$\(stack_output UserPoolClientId\)/);
  assert.match(script, /USER_POOL_CLIENT_ID="\$USER_POOL_CLIENT_ID" API_DOMAIN/);
  assert.match(script, /DesiredCount=0 ActivationEnabled=false/);
  assert.match(script, /productionAppClientVerified/);
});
