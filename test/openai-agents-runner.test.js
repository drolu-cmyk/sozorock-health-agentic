const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAIAgentsSdkRunner } = require('../packages/agents/openai-agents-runner');
const { buildAgentSpecification } = require('../packages/agents/cbcap-orchestrator');

test('official Agents SDK runner builds specialist agent tools with sensitive tracing disabled', async () => {
  let runnerConfig;
  let observed;
  const runner = createOpenAIAgentsSdkRunner({
    apiKey: 'test-key-never-used',
    runnerFactory(config) {
      runnerConfig = config;
      return {
        async run(agent, input, options) {
          observed = { agent, input: JSON.parse(input), options };
          return {
            finalOutput: { kind: 'test-output' },
            newItems: [
              { rawItem: { name: 'synthesize_governed_evidence' } },
              { rawItem: { name: 'draft_reviewable_planning_brief' } },
            ],
            lastAgent: agent,
            lastResponseId: 'response-id',
          };
        },
      };
    },
  });

  const specification = buildAgentSpecification();
  const payload = { contract: 'test-input', countyFips: '36001' };
  const signal = new AbortController().signal;
  const result = await runner.run(specification, payload, {
    model: 'reviewed-model',
    maxTurns: 5,
    maxSpecialistTurns: 1,
    maxOutputTokens: 1800,
    timeoutMs: 20_000,
    signal,
  });

  assert.equal(runnerConfig.tracingDisabled, true);
  assert.equal(runnerConfig.traceIncludeSensitiveData, false);
  assert.equal(observed.agent.tools.length, 2);
  assert.deepEqual(observed.agent.tools.map((tool) => tool.name), [
    'synthesize_governed_evidence',
    'draft_reviewable_planning_brief',
  ]);
  assert.equal(observed.options.maxTurns, 5);
  assert.equal(observed.options.signal, signal);
  assert.equal(observed.input.countyFips, '36001');
  assert.deepEqual(result.trace.toolCalls, [
    'synthesize_governed_evidence',
    'draft_reviewable_planning_brief',
  ]);
});
