import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { handler } from '../update-link-tracking.mjs';

const textResponse = (text) => ({ output: { message: { content: [{ text }] } } });
const toolUseResponse = (name, input) => ({
  output: { message: { content: [{ toolUse: { name, toolUseId: 't1', input } }] } }
});

describe('update-link-tracking handler', () => {
  let mockSend;
  let mockBedrockSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      TABLE_NAME: process.env.TABLE_NAME,
      REDIRECT_URL: process.env.REDIRECT_URL,
      MODEL_ID: process.env.MODEL_ID
    };
    process.env.TABLE_NAME = 'test-table';
    process.env.REDIRECT_URL = 'https://redirect.example.com';
    process.env.MODEL_ID = 'test-model';

    // No existing records by default; writes succeed.
    mockSend = jest.fn().mockResolvedValue({});
    DynamoDBClient.prototype.send = mockSend;

    // Default: model produces no tool call (link stored without classification).
    mockBedrockSend = jest.fn().mockResolvedValue(textResponse('ok'));
    BedrockRuntimeClient.prototype.send = mockBedrockSend;
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv.TABLE_NAME;
    process.env.REDIRECT_URL = originalEnv.REDIRECT_URL;
    process.env.MODEL_ID = originalEnv.MODEL_ID;
  });

  test('rewrites links with issue cid and position parameters', async () => {
    const result = await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'One [first](https://example.com/first) and [second](https://example.com/second?x=1)'
    });

    expect(result.content).toContain('cid=tenant123%2342');
    expect(result.content).toContain('p=1');
    expect(result.content).toContain('p=2');
    expect(result.content).toContain('s=__EMAIL_HASH__');
  });

  test('stores the LLM topic classification and summary on the link record', async () => {
    let bedrockCall = 0;
    mockBedrockSend.mockImplementation(() => {
      bedrockCall += 1;
      // converse() loops: first response asks for the tool, second ends with text.
      if (bedrockCall % 2 === 1) {
        return Promise.resolve(toolUseResponse('submit_link_classification', {
          primaryTopic: 'ai',
          secondaryTopics: ['serverless'],
          summary: 'A deep dive into running LLMs on Lambda.',
          confidence: 0.9
        }));
      }
      return Promise.resolve(textResponse('done'));
    });

    await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'Check out [running LLMs on Lambda](https://example.com/ai-lambda) for details.'
    });

    const putCmd = mockSend.mock.calls
      .map(call => call[0])
      .find(cmd => cmd instanceof PutItemCommand);
    expect(putCmd).toBeDefined();

    const item = unmarshall(putCmd.input.Item);
    expect(item.primaryTopic).toBe('ai');
    expect(item.secondaryTopics).toEqual(['serverless']);
    expect(item.summary).toBe('A deep dive into running LLMs on Lambda.');
    expect(item.confidence).toBe(0.9);
    expect(item.classifiedBy).toBe('llm');
    expect(item.position).toBe(1);
  });

  test('skips classification and write when the link record is already classified', async () => {
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({ Item: marshall({ pk: 'tenant123#42', primaryTopic: 'ai' }) });
      }
      return Promise.resolve({});
    });

    const result = await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'Already [tracked](https://example.com/tracked) link.'
    });

    // Link is still rewritten...
    expect(result.content).toContain('cid=tenant123%2342');
    // ...but no LLM call and no write happen for an already-classified record.
    expect(mockBedrockSend).not.toHaveBeenCalled();
    const writes = mockSend.mock.calls.filter(
      call => call[0] instanceof PutItemCommand || call[0] instanceof UpdateItemCommand
    );
    expect(writes).toHaveLength(0);
  });

  test('re-classifies an existing record that has no topics', async () => {
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        // Record exists (e.g. created by a failed preview) but is unclassified.
        return Promise.resolve({ Item: marshall({ pk: 'tenant123#42' }) });
      }
      return Promise.resolve({});
    });

    let bedrockCall = 0;
    mockBedrockSend.mockImplementation(() => {
      bedrockCall += 1;
      if (bedrockCall % 2 === 1) {
        return Promise.resolve(toolUseResponse('submit_link_classification', {
          primaryTopic: 'security',
          secondaryTopics: [],
          summary: 'A guide to zero-trust auth.',
          confidence: 0.8
        }));
      }
      return Promise.resolve(textResponse('done'));
    });

    await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'See [zero trust](https://example.com/zero-trust) details.'
    });

    // Backfill is an UpdateItem (the base record already exists), not a Put.
    const updateCmd = mockSend.mock.calls
      .map(call => call[0])
      .find(cmd => cmd instanceof UpdateItemCommand);
    expect(updateCmd).toBeDefined();
    const values = unmarshall(updateCmd.input.ExpressionAttributeValues);
    expect(values[':primaryTopic']).toBe('security');
    expect(updateCmd.input.ConditionExpression).toContain('attribute_not_exists(primaryTopic)');

    const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
    expect(putCalls).toHaveLength(0);
  });

  test('does not store low-confidence classifications', async () => {
    let bedrockCall = 0;
    mockBedrockSend.mockImplementation(() => {
      bedrockCall += 1;
      if (bedrockCall % 2 === 1) {
        return Promise.resolve(toolUseResponse('submit_link_classification', {
          primaryTopic: 'ai',
          secondaryTopics: [],
          summary: 'Ambiguous link.',
          confidence: 0.2
        }));
      }
      return Promise.resolve(textResponse('done'));
    });

    await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'A [maybe-ai](https://example.com/maybe) link.'
    });

    const putCmd = mockSend.mock.calls
      .map(call => call[0])
      .find(cmd => cmd instanceof PutItemCommand);
    expect(putCmd).toBeDefined();
    const item = unmarshall(putCmd.input.Item);
    expect(item.primaryTopic).toBeUndefined();
    expect(item.url).toBe('https://example.com/maybe');
  });

  test('still creates the link record when classification fails', async () => {
    mockBedrockSend.mockRejectedValue(new Error('bedrock unavailable'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'A [resilient](https://example.com/resilient) link.'
    });

    const putCmd = mockSend.mock.calls
      .map(call => call[0])
      .find(cmd => cmd instanceof PutItemCommand);
    expect(putCmd).toBeDefined();

    const item = unmarshall(putCmd.input.Item);
    expect(item.url).toBe('https://example.com/resilient');
    expect(item.primaryTopic).toBeUndefined();

    consoleSpy.mockRestore();
  });
});
