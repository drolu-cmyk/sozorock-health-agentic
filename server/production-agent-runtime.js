const { createCBCAPAgentOrchestrator } = require('../packages/agents/cbcap-orchestrator');
const { createOpenAIAgentsSdkRunner } = require('../packages/agents/openai-agents-runner');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const PROMPT_VERSION = /^[a-z0-9][a-z0-9._-]{5,119}$/;

function requiredSecret(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is required.`);
  const secret = value.trim();
  if (secret.length < 20 || secret.length > 512 || /\s/.test(secret)) throw new Error(`${label} is invalid.`);
  return secret;
}

function requiredIdentifier(value, pattern, label) {
  const selected = typeof value === 'string' ? value.trim() : '';
  if (!pattern.test(selected)) throw new Error(`${label} is missing or invalid.`);
  return selected;
}

function parseKillSwitch(value) {
  const selected = String(value || '').trim().toLowerCase();
  if (selected !== 'true' && selected !== 'false') {
    throw new Error('CB_CAP_AGENT_KILL_SWITCH must be exactly true or false.');
  }
  return selected === 'true';
}

function readProductionAgentConfig(env = process.env) {
  const apiKey = requiredSecret(env.OPENAI_API_KEY, 'OPENAI_API_KEY');
  const model = requiredIdentifier(env.CB_CAP_AGENT_MODEL, MODEL_ID, 'CB_CAP_AGENT_MODEL');
  const promptVersion = requiredIdentifier(
    env.CB_CAP_AGENT_PROMPT_VERSION,
    PROMPT_VERSION,
    'CB_CAP_AGENT_PROMPT_VERSION',
  );
  const killSwitchEnabled = parseKillSwitch(env.CB_CAP_AGENT_KILL_SWITCH);
  return { apiKey, model, promptVersion, killSwitchEnabled };
}

function createProductionAgentOrchestratorFactory(options = {}) {
  const env = options.env || process.env;
  const config = readProductionAgentConfig(env);
  let modelRunner = options.modelRunner || null;

  return async function agentOrchestratorForActor(actorInput) {
    validateWorkspaceActor(actorInput);
    if (!modelRunner) modelRunner = createOpenAIAgentsSdkRunner({ apiKey: config.apiKey });
    return createCBCAPAgentOrchestrator({
      model: config.model,
      promptVersion: config.promptVersion,
      modelRunner,
      killSwitch: () => {
        try {
          return parseKillSwitch(env.CB_CAP_AGENT_KILL_SWITCH);
        } catch {
          return true;
        }
      },
    });
  };
}

function safeProductionAgentConfig(env = process.env) {
  const config = readProductionAgentConfig(env);
  return {
    model: config.model,
    promptVersion: config.promptVersion,
    killSwitchEnabled: config.killSwitchEnabled,
  };
}

module.exports = {
  MODEL_ID,
  PROMPT_VERSION,
  createProductionAgentOrchestratorFactory,
  parseKillSwitch,
  readProductionAgentConfig,
  safeProductionAgentConfig,
};
