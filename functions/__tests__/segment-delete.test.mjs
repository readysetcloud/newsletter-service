import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

let handler;
let ddbSend;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      BatchWriteItemCommand: jest.fn((params) => ({ __type: 'BatchWrite', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: (obj) => {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') result[key] = { S: value };
          else if (typeof value === 'number') result[key] = { N: String(value) };
        }
        return result;
      },
      unmarshall: (item) => {
        const result = {};
        for (const [key, val] of Object.entries(item)) {
          if (val.S !== undefined) result[key] = val.S;
          else if (val.N !== undefined) result[key] = Number(val.N);
        }
        return result;
      },
    }));

    jest.unstable_mockModule('../utils/helpers.mjs', () => ({
      sendWithRetry: jest.fn((fn) => fn()),
    }));

    ({ handler } = await import('../subscribers/segment-delete.mjs'));
  });
};

describe('segment-delete', () => {
  let originalEnv;

  beforeEach(async () => {
    jest.resetModules();
    originalEnv = { ...process.env };
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    await loadIsolated();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Validates: Requirements 4.1, 4.2
   */
  it('deletes all member records in a single page', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        { tenantId: { S: 'tenant1' }, email: { S: 'SEGMENT#seg1#MEMBER#a@test.com' } },
        { tenantId: { S: 'tenant1' }, email: { S: 'SEGMENT#seg1#MEMBER#b@test.com' } },
      ],
    });
    // BatchWriteItem response
    ddbSend.mockResolvedValueOnce({});

    const result = await handler({ tenantId: 'tenant1', segmentId: 'seg1' });

    expect(result.deleted).toBe(2);
    // 1 query + 1 batch write
    expect(ddbSend).toHaveBeenCalledTimes(2);
  });

  /**
   * Validates: Requirements 4.1, 4.2
   */
  it('handles paginated query results across multiple pages', async () => {
    // First page with LastEvaluatedKey
    ddbSend.mockResolvedValueOnce({
      Items: [
        { tenantId: { S: 'tenant1' }, email: { S: 'SEGMENT#seg1#MEMBER#a@test.com' } },
      ],
      LastEvaluatedKey: { tenantId: { S: 'tenant1' }, email: { S: 'SEGMENT#seg1#MEMBER#a@test.com' } },
    });
    // BatchWriteItem for first page
    ddbSend.mockResolvedValueOnce({});
    // Second page with no LastEvaluatedKey
    ddbSend.mockResolvedValueOnce({
      Items: [
        { tenantId: { S: 'tenant1' }, email: { S: 'SEGMENT#seg1#MEMBER#b@test.com' } },
      ],
    });
    // BatchWriteItem for second page
    ddbSend.mockResolvedValueOnce({});

    const result = await handler({ tenantId: 'tenant1', segmentId: 'seg1' });

    expect(result.deleted).toBe(2);
    // 2 queries + 2 batch writes
    expect(ddbSend).toHaveBeenCalledTimes(4);
  });

  /**
   * Validates: Requirements 4.1, 4.2
   */
  it('batches deletes in groups of 25', async () => {
    // Generate 30 items to force two batches (25 + 5)
    const items = Array.from({ length: 30 }, (_, i) => ({
      tenantId: { S: 'tenant1' },
      email: { S: `SEGMENT#seg1#MEMBER#user${i}@test.com` },
    }));

    ddbSend.mockResolvedValueOnce({ Items: items });
    // First batch of 25
    ddbSend.mockResolvedValueOnce({});
    // Second batch of 5
    ddbSend.mockResolvedValueOnce({});

    const result = await handler({ tenantId: 'tenant1', segmentId: 'seg1' });

    expect(result.deleted).toBe(30);
    // 1 query + 2 batch writes
    expect(ddbSend).toHaveBeenCalledTimes(3);
  });

  /**
   * Validates: Requirements 4.1, 4.2
   */
  it('handles segment with no members', async () => {
    ddbSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler({ tenantId: 'tenant1', segmentId: 'seg1' });

    expect(result.deleted).toBe(0);
    // Only the query, no batch writes
    expect(ddbSend).toHaveBeenCalledTimes(1);
  });

  /**
   * Validates: Requirements 4.1, 4.2
   */
  it('handles query returning no Items property', async () => {
    ddbSend.mockResolvedValueOnce({});

    const result = await handler({ tenantId: 'tenant1', segmentId: 'seg1' });

    expect(result.deleted).toBe(0);
    expect(ddbSend).toHaveBeenCalledTimes(1);
  });
});
