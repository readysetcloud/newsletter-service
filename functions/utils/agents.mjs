import { Agent, BedrockModel, tool } from '@strands-agents/sdk';

const DEFAULT_MODEL_MAX_TOKENS = 4096;

export const converse = async (model, systemPrompt, userPrompt, toolDefs = [], options = {}) => {
  const agent = new Agent({
    model: new BedrockModel({
      modelId: model,
      maxTokens: options.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS,
      temperature: options.temperature ?? 0.2,
      stream: false
    }),
    systemPrompt,
    tools: toolDefs.map(toolDef => toStrandsTool(toolDef, options)),
    toolExecutor: 'sequential',
    printer: false
  });

  const result = await agent.invoke(userPrompt, {
    limits: {
      turns: options.maxTurns ?? (toolDefs.length ? 1 : 3),
      totalTokens: options.maxTotalTokens
    },
    cancelSignal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined
  });

  return result.toString();
};

const toStrandsTool = (toolDef, options) => tool({
  name: toolDef.name,
  description: toolDef.description,
  inputSchema: toolDef.schema,
  callback: async (input) => {
    if (options?.tenantId && toolDef.isMultiTenant) {
      return toolDef.handler({
        tenantId: options.tenantId,
        ...(options.userId && { userId: options.userId })
      }, input);
    }

    return toolDef.handler(input);
  }
});
