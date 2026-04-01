import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

let handler;
let ddbSend;
let s3Send;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();
    s3Send = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
      S3Client: jest.fn(() => ({ send: s3Send })),
      PutObjectCommand: jest.fn((params) => ({ __type: 'PutObject', ...params })),
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
      getTenant: jest.fn().mockResolvedValue({ tenantId: 'tenant1', name: 'Test' }),
      sendWithRetry: jest.fn((fn) => fn()),
    }));

    ({ handler } = await import('../subscribers/export-subscribers.mjs'));
  });
};

describe('export-subscribers', () => {
  let originalEnv;

  beforeEach(async () => {
    jest.resetModules();
    originalEnv = { ...process.env };
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    process.env.BUCKET = 'test-bucket';
    await loadIsolated();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Validates: Requirements 6.1, 6.2
   */
  it('subscriber with engagement fields included correctly', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        {
          tenantId: { S: 'tenant1' },
          email: { S: 'active@example.com' },
          lastEngagedIssue: { N: '25' },
          engagementCount: { N: '12' },
        },
      ],
    });
    s3Send.mockResolvedValueOnce({});

    const result = await handler({ tenant: 'tenant1' });

    expect(result.key).toBeDefined();

    const putCall = s3Send.mock.calls[0][0];
    const report = JSON.parse(putCall.Body);

    expect(report.total).toBe(1);
    expect(report.addresses).toEqual(['active@example.com']);
    expect(report.subscribers).toHaveLength(1);
    expect(report.subscribers[0]).toEqual({
      email: 'active@example.com',
      lastEngagedIssue: 25,
      engagementCount: 12,
    });
  });

  /**
   * Validates: Requirements 6.1, 6.2
   */
  it('subscriber without engagement fields gets null values', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        {
          tenantId: { S: 'tenant1' },
          email: { S: 'inactive@example.com' },
        },
      ],
    });
    s3Send.mockResolvedValueOnce({});

    const result = await handler({ tenant: 'tenant1' });

    expect(result.key).toBeDefined();

    const putCall = s3Send.mock.calls[0][0];
    const report = JSON.parse(putCall.Body);

    expect(report.total).toBe(1);
    expect(report.subscribers).toHaveLength(1);
    expect(report.subscribers[0]).toEqual({
      email: 'inactive@example.com',
      lastEngagedIssue: null,
      engagementCount: null,
    });
  });
});
