import { jest } from '@jest/globals';
import { DynamoDBClient, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { classifyAndStoreLinkMetadata } from '../update-link-tracking.mjs';

describe('classifyAndStoreLinkMetadata', () => {
  let mockSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn().mockResolvedValue({});
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  test('should classify and store Link_Metadata for a classifiable link', async () => {
    // GetItem returns no existing metadata
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    await classifyAndStoreLinkMetadata('https://aws.amazon.com/lambda/getting-started', 'Getting started with serverless');

    const getCalls = mockSend.mock.calls.filter(c => c[0] instanceof GetItemCommand);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0][0].input.TableName).toBe('test-table');

    const getKey = unmarshall(getCalls[0][0].input.Key);
    expect(getKey.pk).toBe('LINK_META');

    const putCalls = mockSend.mock.calls.filter(c => c[0] instanceof PutItemCommand);
    expect(putCalls).toHaveLength(1);

    const item = unmarshall(putCalls[0][0].input.Item);
    expect(item.pk).toBe('LINK_META');
    expect(item.originalUrl).toBe('https://aws.amazon.com/lambda/getting-started');
    expect(item.normalizedUrl).toBeDefined();
    expect(item.primaryTopic).toBeDefined();
    expect(item.confidence).toBeGreaterThanOrEqual(0.5);
    expect(item.classifiedBy).toBe('heuristic');
    expect(item.classifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(putCalls[0][0].input.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
  });

  test('should skip classification when Link_Metadata already exists', async () => {
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({
          Item: marshall({
            pk: 'LINK_META',
            sk: 'abc123',
            primaryTopic: 'serverless',
            secondaryTopics: [],
            confidence: 1.0
          })
        });
      }
      return Promise.resolve({});
    });

    await classifyAndStoreLinkMetadata('https://aws.amazon.com/lambda', 'Lambda docs');

    const putCalls = mockSend.mock.calls.filter(c => c[0] instanceof PutItemCommand);
    expect(putCalls).toHaveLength(0);
  });

  test('should skip classification when URL normalization fails (returns null)', async () => {
    await classifyAndStoreLinkMetadata('not-a-valid-url', 'some text');

    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should skip storing when classification confidence is below 0.5', async () => {
    // GetItem returns no existing metadata
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    // Use a URL/anchor that won't match any topic keywords
    await classifyAndStoreLinkMetadata('https://example.com/random-page', 'click here for more');

    const putCalls = mockSend.mock.calls.filter(c => c[0] instanceof PutItemCommand);
    expect(putCalls).toHaveLength(0);
  });

  test('should swallow ConditionalCheckFailedException (race condition)', async () => {
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({});
      }
      if (command instanceof PutItemCommand) {
        const err = new Error('Condition not met');
        err.name = 'ConditionalCheckFailedException';
        return Promise.reject(err);
      }
      return Promise.resolve({});
    });

    // Should not throw
    await classifyAndStoreLinkMetadata('https://aws.amazon.com/lambda', 'Serverless Lambda');
  });

  test('should swallow classification errors without breaking the pipeline', async () => {
    mockSend.mockImplementation(() => {
      throw new Error('DynamoDB unavailable');
    });

    // Should not throw
    await classifyAndStoreLinkMetadata('https://aws.amazon.com/lambda', 'Serverless Lambda');
  });

  test('should store secondaryTopics array in Link_Metadata', async () => {
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    await classifyAndStoreLinkMetadata('https://aws.amazon.com/lambda/serverless-devops', 'Serverless DevOps with Lambda');

    const putCalls = mockSend.mock.calls.filter(c => c[0] instanceof PutItemCommand);
    expect(putCalls).toHaveLength(1);

    const item = unmarshall(putCalls[0][0].input.Item);
    expect(Array.isArray(item.secondaryTopics)).toBe(true);
    expect(item.secondaryTopics.length).toBeLessThanOrEqual(2);
  });
});
