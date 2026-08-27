const DEFAULT_AGENT_MODEL_POLICY = Object.freeze({
  contract: 'cbcap.agent-model-policy.v1',
  promptVersion: 'cbcap-agent-prompts-2026-08-26-v1',
  maxTurns: 5,
  maxSpecialistTurns: 1,
  maxToolCalls: 2,
  maxInputBytes: 96 * 1024,
  maxOutputTokens: 1800,
  timeoutMs: 20_000,
});

function integerInRange(value, fallback, minimum, maximum, label) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return selected;
}

function createAgentModelPolicy(options = {}) {
  const model = typeof options.model === 'string' ? options.model.trim() : '';
  if (!model) throw new Error('A reviewed OpenAI agent model is required.');
  const killSwitch = options.killSwitch || (() => false);
  if (typeof killSwitch !== 'function') throw new Error('Agent model killSwitch must be a function.');

  return Object.freeze({
    ...DEFAULT_AGENT_MODEL_POLICY,
    model,
    promptVersion: typeof options.promptVersion === 'string' && options.promptVersion.trim()
      ? options.promptVersion.trim()
      : DEFAULT_AGENT_MODEL_POLICY.promptVersion,
    maxTurns: integerInRange(options.maxTurns, DEFAULT_AGENT_MODEL_POLICY.maxTurns, 3, 8, 'maxTurns'),
    maxSpecialistTurns: integerInRange(
      options.maxSpecialistTurns,
      DEFAULT_AGENT_MODEL_POLICY.maxSpecialistTurns,
      1,
      2,
      'maxSpecialistTurns',
    ),
    maxToolCalls: integerInRange(options.maxToolCalls, DEFAULT_AGENT_MODEL_POLICY.maxToolCalls, 2, 2, 'maxToolCalls'),
    maxInputBytes: integerInRange(
      options.maxInputBytes,
      DEFAULT_AGENT_MODEL_POLICY.maxInputBytes,
      1024,
      256 * 1024,
      'maxInputBytes',
    ),
    maxOutputTokens: integerInRange(
      options.maxOutputTokens,
      DEFAULT_AGENT_MODEL_POLICY.maxOutputTokens,
      256,
      4096,
      'maxOutputTokens',
    ),
    timeoutMs: integerInRange(options.timeoutMs, DEFAULT_AGENT_MODEL_POLICY.timeoutMs, 100, 60_000, 'timeoutMs'),
    killSwitch,
  });
}

module.exports = { DEFAULT_AGENT_MODEL_POLICY, createAgentModelPolicy };
