const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

test('retired activation exits before AWS, database recovery, or cleanup commands', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'cbcap-retired-'));
  try {
    const log = path.join(temporary, 'aws-called');
    writeFileSync(path.join(temporary, 'aws'), '#!/bin/sh\ntouch "$AWS_CALL_LOG"\nexit 99\n', { mode: 0o755 });
    const result = spawnSync('bash', [path.resolve(__dirname, '../scripts/deploy-production-runtime.sh')], {
      cwd: temporary, encoding: 'utf8',
      env: { PATH: `${temporary}:${process.env.PATH}`, AWS_CALL_LOG: log },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /permanently retired/);
    assert.equal(existsSync(log), false, 'even an inventory or cleanup AWS call is prohibited');
    assert.equal(existsSync(path.join(temporary, 'output')), false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('retired workflow cannot authenticate and reports rejection instead of a skipped success', () => {
  const workflow = readFileSync(path.resolve(__dirname, '../.github/workflows/deploy-production-runtime.yml'), 'utf8');
  assert.match(workflow, /activate:[\s\S]*?if: \$\{\{ false \}\}/);
  assert.doesNotMatch(workflow, /id-token: write/);
  const rejection = workflow.slice(workflow.indexOf('  retired-release:'));
  assert.match(rejection, /exit 1/);
  assert.doesNotMatch(rejection, /if:|needs:|configure-aws|\baws\s/);
});

test('historical runtime template cannot be deployed through a parameter override', () => {
  const template = readFileSync(path.resolve(__dirname, '../infrastructure/cloudformation/cbcap-agentic-runtime.yml'), 'utf8');
  const rules = template.slice(template.indexOf('Rules:'), template.indexOf('Parameters:'));
  assert.match(rules, /RdsPermanentlyRetired:/);
  assert.match(rules, /Fn::Equals: \[rds-retired, rds-enabled\]/);
  assert.doesNotMatch(rules, /RuleCondition:|!Ref|Ref:/);
});
