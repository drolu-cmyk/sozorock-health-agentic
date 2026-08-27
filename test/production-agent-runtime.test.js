const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProductionAgentOrchestratorFactory,
  readProductionAgentConfig,
  safeProductionAgentConfig,
} = require('../server/production-agent-runtime');

function recordingRunner() {
  const calls = [];
  return { calls, async run(...args) { calls.push(args); throw new Error('not expected'); } };
}

function productionEnv(overrides = {}) {
  return {
    OPENAI_API_KEY: 'test-openai-key-not-live-123456',
    CB_CAP_AGENT_MODEL: 'gpt-5-mini',
    CB_CAP_AGENT_PROMPT_VERSION: 'cbcap-prompts-v1',
    CB_CAP_AGENT_KILL_SWITCH: 'false',
    ...overrides,
  };
}

const actor = Object.freeze({
  tenantId: 'tenant-a',
  principalId: 'planner-a',
  role: 'county_planner',
  access: 'owner',
  actorType: 'human',
});

test('production agent configuration is strict and its safe form never exposes the API key', () => {
  const config = readProductionAgentConfig(productionEnv());
  assert.equal(config.model, 'gpt-5-mini');
  assert.equal(config.killSwitchEnabled, false);
  const safe = safeProductionAgentConfig(productionEnv());
  assert.deepEqual(safe, {
    model: 'gpt-5-mini',
    promptVersion: 'cbcap-prompts-v1',
    killSwitchEnabled: false,
  });
  assert.equal(JSON.stringify(safe).includes('test-openai'), false);

  for (const overrides of [
    { OPENAI_API_KEY: '' },
    { CB_CAP_AGENT_MODEL: 'bad model' },
    { CB_CAP_AGENT_PROMPT_VERSION: 'LATEST!' },
    { CB_CAP_AGENT_KILL_SWITCH: '0' },
  ]) assert.throws(() => readProductionAgentConfig(productionEnv(overrides)));
});

test('production orchestrator is scoped to a validated actor and uses the configured model policy', async () => {
  const runner = recordingRunner();
  const factory = createProductionAgentOrchestratorFactory({ env: productionEnv(), modelRunner: runner });
  await assert.rejects(() => factory({ tenantId: 'tenant-a' }), /principalId/);
  assert.equal(runner.calls.length, 0);

  const orchestrator = await factory(actor);
  assert.equal(orchestrator.policy.model, 'gpt-5-mini');
  assert.equal(orchestrator.policy.promptVersion, 'cbcap-prompts-v1');
  assert.equal(runner.calls.length, 0);
});

test('production kill switch is evaluated again for every run and invalid changes fail closed', async () => {
  const env = productionEnv();
  const runner = recordingRunner();
  const factory = createProductionAgentOrchestratorFactory({ env, modelRunner: runner });
  const orchestrator = await factory(actor);
  env.CB_CAP_AGENT_KILL_SWITCH = 'invalid';
  await assert.rejects(() => orchestrator.run({}), /disabled/i);
  assert.equal(runner.calls.length, 0);
});
