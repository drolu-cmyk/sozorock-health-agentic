const { Agent, OpenAIProvider, Runner } = require('@openai/agents');

function toolNameFromItem(item) {
  const raw = item?.rawItem || item?.item || item;
  const name = raw?.name || raw?.toolName || raw?.function?.name || null;
  return typeof name === 'string' ? name : null;
}

function createOpenAIAgentsSdkRunner(options = {}) {
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for the OpenAI Agents SDK runner.');
  const runnerFactory = options.runnerFactory || ((config) => new Runner(config));

  return {
    async run(specification, payload, runOptions) {
      const modelProvider = new OpenAIProvider({ apiKey, useResponses: true });
      const specialistAgents = specification.specialists.map((definition) => new Agent({
        name: definition.name,
        instructions: definition.instructions,
        model: runOptions.model,
        outputType: definition.outputSchema,
        modelSettings: {
          maxTokens: runOptions.maxOutputTokens,
          parallelToolCalls: false,
          store: false,
          timeoutMs: runOptions.timeoutMs,
        },
      }));

      const tools = specialistAgents.map((agent, index) => agent.asTool({
        toolName: specification.specialists[index].toolName,
        toolDescription: specification.specialists[index].toolDescription,
        runConfig: {
          modelProvider,
          tracingDisabled: true,
          traceIncludeSensitiveData: false,
        },
        runOptions: {
          maxTurns: runOptions.maxSpecialistTurns,
          signal: runOptions.signal,
        },
      }));

      const orchestrator = new Agent({
        name: specification.name,
        instructions: specification.instructions,
        model: runOptions.model,
        tools,
        outputType: specification.outputSchema,
        modelSettings: {
          maxTokens: runOptions.maxOutputTokens,
          parallelToolCalls: false,
          store: false,
          timeoutMs: runOptions.timeoutMs,
        },
      });
      const runner = runnerFactory({
        modelProvider,
        tracingDisabled: true,
        traceIncludeSensitiveData: false,
        workflowName: 'CB-CAP governed planning draft',
      });
      try {
        const result = await runner.run(orchestrator, JSON.stringify(payload), {
          maxTurns: runOptions.maxTurns,
          signal: runOptions.signal,
        });
        const toolCalls = (result.newItems || []).map(toolNameFromItem).filter((name) => tools.some((tool) => tool.name === name));
        return {
          output: result.finalOutput,
          trace: {
            lastAgent: result.lastAgent?.name || null,
            responseId: result.lastResponseId || null,
            toolCalls,
          },
        };
      } finally {
        await modelProvider.close();
      }
    },
  };
}

module.exports = { createOpenAIAgentsSdkRunner, toolNameFromItem };
