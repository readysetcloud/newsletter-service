import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const mockClassifyLinkWithLlm = jest.fn();

jest.unstable_mockModule('../utils/llm-link-classifier.mjs', () => ({
  classifyLinkWithLlm: mockClassifyLinkWithLlm
}));

const { handler } = await import('../update-link-tracking.mjs');

// The handler no longer rewrites content (web link wrapping moved to the Hugo
// render hook, email links are tracked by SES). Its job is to create the issue's
// link# tracking records, so these tests assert on the DynamoDB writes.
const putItems = (mockSend) =>
  mockSend.mock.calls
    .map(call => call[0])
    .filter(cmd => cmd instanceof PutItemCommand)
    .map(cmd => unmarshall(cmd.input.Item));

describe('update-link-tracking handler', () => {
  let mockSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      TABLE_NAME: process.env.TABLE_NAME,
      MODEL_ID: process.env.MODEL_ID
    };
    process.env.TABLE_NAME = 'test-table';
    process.env.MODEL_ID = 'test-model';

    // No existing records by default; writes succeed.
    mockSend = jest.fn().mockResolvedValue({});
    DynamoDBClient.prototype.send = mockSend;
    mockClassifyLinkWithLlm.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv.TABLE_NAME;
    process.env.MODEL_ID = originalEnv.MODEL_ID;
    jest.clearAllMocks();
  });

  test('creates a link record per http(s) link with issue pk and position', async () => {
    const result = await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'One [first](https://example.com/first) and [second](https://example.com/second?x=1)'
    });

    expect(result).toEqual({ success: true, linkCount: 2 });

    const records = putItems(mockSend);
    expect(records).toHaveLength(2);
    expect(records.every(r => r.pk === 'tenant123#42')).toBe(true);
    const byUrl = Object.fromEntries(records.map(r => [r.url, r]));
    expect(byUrl['https://example.com/first'].position).toBe(1);
    expect(byUrl['https://example.com/second?x=1'].position).toBe(2);
  });

  test('skips mailto and relative links, tracking only absolute http(s) links', async () => {
    const result = await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'Email [us](mailto:hi@example.com), read the [post](https://example.com/post), or go [home](/index).'
    });

    expect(result.linkCount).toBe(1);
    const records = putItems(mockSend);
    expect(records).toHaveLength(1);
    expect(records[0].url).toBe('https://example.com/post');
    expect(records[0].position).toBe(1);
  });

  test('tracks each distinct URL when a URL is reused or is a prefix of others', async () => {
    // The homepage URL is a prefix of the article URL and appears twice. Each
    // `[text](url)` match is counted independently, so both distinct URLs get a
    // record and the reused URL does not corrupt the others.
    const home = 'https://readysetcloud.io';
    const article = 'https://readysetcloud.io/serverless';
    const result = await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: `Welcome to [home](${home}). Read [serverless](${article}). Visit [home again](${home}).`
    });

    // All three occurrences counted (positions 1, 2, 3).
    expect(result.linkCount).toBe(3);
    const urls = putItems(mockSend).map(r => r.url);
    expect(urls).toContain(home);
    expect(urls).toContain(article);
  });

  test('stores the LLM topic classification and summary on the link record', async () => {
    mockClassifyLinkWithLlm.mockResolvedValue({
      primaryTopic: 'ai',
      secondaryTopics: ['serverless'],
      summary: 'A deep dive into running LLMs on Lambda.',
      confidence: 0.9,
      classifiedBy: 'llm'
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
    expect(mockClassifyLinkWithLlm).toHaveBeenCalledTimes(1);
  });

  test('skips classification and write when the link record is already classified', async () => {
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({ Item: marshall({ pk: 'tenant123#42', primaryTopic: 'ai' }) });
      }
      return Promise.resolve({});
    });

    await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'Already [tracked](https://example.com/tracked) link.'
    });

    // No LLM call and no write happen for an already-classified record.
    expect(mockClassifyLinkWithLlm).not.toHaveBeenCalled();
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

    mockClassifyLinkWithLlm.mockResolvedValue({
      primaryTopic: 'security',
      secondaryTopics: [],
      summary: 'A guide to zero-trust auth.',
      confidence: 0.8,
      classifiedBy: 'llm'
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
    expect(mockClassifyLinkWithLlm).toHaveBeenCalledTimes(1);
  });

  test('does not store low-confidence classifications', async () => {
    mockClassifyLinkWithLlm.mockResolvedValue(null);

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
    mockClassifyLinkWithLlm.mockResolvedValue(null);

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
  });

  test('waits for link enrichment writes before returning', async () => {
    let resolveWrite;
    const pendingWrite = new Promise((resolve) => {
      resolveWrite = resolve;
    });
    let handlerResolved = false;

    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({});
      }
      if (command instanceof PutItemCommand) {
        return pendingWrite;
      }
      return Promise.resolve({});
    });

    const handlerPromise = handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'One [first](https://aws.amazon.com/lambda)'
    }).then((result) => {
      handlerResolved = true;
      return result;
    });

    await Promise.resolve();
    expect(handlerResolved).toBe(false);

    resolveWrite({});
    const result = await handlerPromise;

    expect(result).toEqual({ success: true, linkCount: 1 });
    expect(mockSend.mock.calls.some(([command]) => command instanceof PutItemCommand)).toBe(true);
  });
});
