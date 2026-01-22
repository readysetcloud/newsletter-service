import { z } from 'zod';
import { Logger } from '@aws-lambda-powertools/logger';
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const logger = new Logger({ serviceName: 'utils' });
const bedrock = new BedrockRuntimeClient();
const MAX_ITERATIONS = 10;
const MAX_TOKENS = 10000;

export const converse = async (model, systemPrompt, userPrompt, toolDefs, options) => {
  let conversation = [];
  const messages = [{ role: 'user', content: [{ text: userPrompt }] }];
  let finalResponse = '';
  let iteration = 0;

  const tools = convertToBedrockTools(toolDefs || []);
  while (iteration < MAX_ITERATIONS) {
    iteration++;
    try {
      const command = new ConverseCommand({
        modelId: model,
        system: [{ text: systemPrompt }],
        messages: [...conversation, ...messages],
        ...tools.length && { toolConfig: { tools: tools.map(t => { return { toolSpec: t.spec }; }) } },
        inferenceConfig: { maxTokens: MAX_TOKENS }
      });

      const response = await bedrock.send(command);

      if (!response.output?.message?.content) {
        logger.warn('No message output on iteration', {
          iteration: iteration + 1,
          response: JSON.stringify(response, null, 2)
        });
        break;
      }

      const messageContent = response.output.message.content;
      messages.push({ role: 'assistant', content: messageContent });

      // Check if we have tool use or just text
      const toolUseItems = messageContent.filter(item => 'toolUse' in item && !!item.toolUse);
      const textItems = messageContent.filter(item => 'text' in item && !!item.text);

      if (toolUseItems.length) {
        const message = { role: 'user', content: [] };
        for (const toolUseItem of toolUseItems) {
          const { toolUse } = toolUseItem;
          const { name: toolName, input: toolInput, toolUseId } = toolUse;

          logger.info('Tool called', {
            iteration: iteration + 1,
            toolName,
            toolInput,
            toolUseId
          });

          let toolResult;
          try {
            const tool = tools.find(t => t.spec.name === toolName);
            if (!tool) {
              throw new Error(`Unknown tool: ${toolName}`);
            }

            // Never allow an LLM to provide a tenant id!! Instead infer it from the code for security purposes
            if (options?.tenantId && tool.isMultiTenant) {
              const context = {
                tenantId: options.tenantId,
                ...options.userId && { userId: options.userId }
              };
              toolResult = await tool.handler(context, toolInput);
            } else {
              toolResult = await tool.handler(toolInput);
            }
          } catch (toolError) {
            toolResult = { error: toolError.message };
          }
          logger.info('Tool result', { toolName, toolResult });
          const toolResultBlock = {
            toolUseId,
            content: [{ text: JSON.stringify(toolResult) }]
          };

          message.content.push({ toolResult: toolResultBlock });
        }
        messages.push(message);
      } else if (textItems.length > 0) {
        finalResponse = textItems.map(item => item.text).join('');
        break;
      } else {
        logger.warn('Unexpected content structure', {
          iteration: iteration + 1,
          messageContent
        });
        finalResponse = 'Received unexpected response type from model';
        break;
      }
    } catch (error) {
      logger.error('Error on iteration', {
        iteration,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  if (!finalResponse && iteration >= MAX_ITERATIONS) {
    logger.warn('Stopped due to iteration limit', {
      maxIterations: MAX_ITERATIONS
    });
  }

  if (!finalResponse && messages.length > 1) {
    const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMessage?.content) {
      const textContent = lastAssistantMessage.content
        .filter(item => 'text' in item && !!item.text)
        .map(item => item.text)
        .join('');
      if (textContent) {
        finalResponse = textContent;
      }
    }
  }

  return sanitizeResponse(finalResponse, { preserveThinkingTags: false }) || 'No response generated';
};

const sanitizeResponse = (text, options = {}) => {
  if (options?.preserveThinkingTags) {
    return text.trim();
  }
  return text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim();
};

const convertToBedrockTools = (toolDefs) => {
  return toolDefs?.map(toolDef => {
    return {
      isMultiTenant: toolDef.isMultiTenant,
      spec: {
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: { json: z.toJSONSchema(toolDef.schema) }
      },
      handler: toolDef.handler
    };
  }) ?? [];
};
