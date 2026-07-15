import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const mockClassifyLinkWithLlm = jest.fn();

jest.unstable_mockModule('../utils/llm-link-classifier.mjs', () => ({
  classifyLinkWithLlm: mockClassifyLinkWithLlm
}));

const { handler } = await import('../update-link-tracking.mjs');

describe('update-link-tracking handler', () => {
  let mockSend;
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
    mockClassifyLinkWithLlm.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv.TABLE_NAME;
    process.env.REDIRECT_URL = originalEnv.REDIRECT_URL;
    process.env.MODEL_ID = originalEnv.MODEL_ID;
    jest.clearAllMocks();
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

  test('encodes the destination so query-string links round-trip to the same hash', async () => {
    // A URL with query params (UTM tags) must be encoded such that its `&`/`?`
    // do not leak out of the `u=` param and split the redirect query string.
    // Otherwise the redirect truncates the destination and the logged click
    // hashes to a different link record, so the increment is silently dropped.
    const url = 'https://example.com/post?utm_source=newsletter&utm_medium=email';
    const result = await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: `Read [the post](${url}) today.`
    });

    const expected = `u=${encodeURIComponent(url)}`;
    expect(result.content).toContain(expected);
    // The raw, unescaped ampersand must not appear inside the tracking link.
    expect(result.content).not.toContain('utm_medium=email&cid=');
    // The value under `u=` must decode back to the exact original URL.
    const uValue = result.content.match(/u=([^&]+)&cid=/)[1];
    expect(decodeURIComponent(uValue)).toBe(url);
  });

  test('tracks every occurrence when a URL is reused / is a prefix of others', async () => {
    // The homepage URL is a prefix of the article URL and appears twice. The old
    // first-occurrence substring replace left later occurrences un-tracked and
    // corrupted earlier links; every link must now become a distinct tracking URL.
    const home = 'https://readysetcloud.io';
    const article = 'https://readysetcloud.io/serverless';
    const result = await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: `Welcome to [home](${home}). Read [serverless](${article}). Visit [home again](${home}).`
    });

    // No original URL should remain as a bare markdown target (all rewritten).
    expect(result.content).not.toContain(`](${home})`);
    expect(result.content).not.toContain(`](${article})`);
    // Positions 1, 2, 3 all present -> all three links tracked.
    expect(result.content).toContain('p=1');
    expect(result.content).toContain('p=2');
    expect(result.content).toContain('p=3');
    // No double-wrapped redirect (a symptom of the substring-collision bug).
    expect(result.content).not.toMatch(/u=[^&]*r(?:edirect)?\.example\.com/);
    expect(result.content).not.toContain(`u=${encodeURIComponent(process.env.REDIRECT_URL)}`);
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

    const result = await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'Already [tracked](https://example.com/tracked) link.'
    });

    // Link is still rewritten...
    expect(result.content).toContain('cid=tenant123%2342');
    // ...but no LLM call and no write happen for an already-classified record.
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

    expect(result.content).toContain('https://redirect.example.com');
    expect(mockSend.mock.calls.some(([command]) => command instanceof PutItemCommand)).toBe(true);
  });
});
