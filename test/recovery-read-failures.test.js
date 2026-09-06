const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {spawnSync} = require('node:child_process');

const script = readFileSync(join(__dirname, '../scripts/deploy-production-runtime.sh'), 'utf8');
const recovery = script.slice(script.indexOf('recover_failed_initial_stack() {'), script.indexOf('\ndisable_runtime()'));

for (const failure of ['describe-stack-events', 'list-stack-resources', 'describe-user-pool', 'list-users', 'missing-users', 'none']) {
  test(`first-create recovery verifies every read (${failure})`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbcap-recovery-'));
    try {
      const events = {StackEvents: [
        {LogicalResourceId: 'UserPool', ResourceStatus: 'CREATE_FAILED', ResourceStatusReason: "Value 'true' at 'mfaConfiguration'"},
        {LogicalResourceId: 'UserPool', ResourceStatus: 'DELETE_FAILED', ResourceStatusReason: 'deletion protection is activated'},
      ]};
      const resources = {StackResourceSummaries: [{LogicalResourceId: 'UserPool', PhysicalResourceId: 'us-east-1_TestPool'}]};
      const pool = {UserPool: {Id: 'us-east-1_TestPool', Name: 'cbcap-agentic-workspace', DeletionProtection: 'ACTIVE', EstimatedNumberOfUsers: 0, Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_TestPool'}};
      for (const [name, value] of Object.entries({events, resources, pool})) writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
      writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
if [[ "$2" == "$FAILURE" ]]; then exit 254; fi
case "$2" in
  describe-stack-events) cat "$FIXTURES/events.json";;
  list-stack-resources) cat "$FIXTURES/resources.json";;
  describe-user-pool) cat "$FIXTURES/pool.json";;
  list-users) if [[ "$FAILURE" == missing-users ]]; then echo '{}'; else echo '{"Users":[]}'; fi;;
  *) touch "$FIXTURES/mutated";;
esac
`, {mode: 0o755});
      const result = spawnSync('bash', ['-c', `${recovery}\nif ! recover_failed_initial_stack; then exit 23; fi`], {
        encoding: 'utf8',
        env: {...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURES: dir, FAILURE: failure, RUNTIME_STACK: 'test', EXPECTED_AWS_ACCOUNT_ID: '123456789012', AWS_REGION: 'us-east-1'},
      });
      assert.equal(result.status, failure === 'none' ? 0 : 23, result.stderr);
      assert.equal(existsSync(join(dir, 'mutated')), failure === 'none');
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
}
