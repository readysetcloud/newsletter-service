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
      BatchGetItemCommand: jest.fn((params) => ({ __type: 'BatchGet', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'Update', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
      S3Client: jest.fn(() => ({ send: s3Send })),
      PutObjectCommand: jest.fn((params) => ({ __type: 'PutObject', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: (obj) => {
        const r = {};
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') r[key] = { S: value };
          else if (typeof value === 'number') r[key] = { N: String(value) };
        }
        return r;
      },
      unmarshall: (item) => {
        const r = {};
        for (const [key, val] of Object.entries(item)) {
          if (val.S !== undefined) r[key] = val.S;
          else if (val.N !== undefined) r[key] = Number(val.N);
        }
        return r;
      },
    }));

    jest.unstable_mockModule('../utils/helpers.mjs', () => ({
      sendWithRetry: jest.fn((fn) => fn()),
    }));

    ({ handler } = await import('../subscribers/segment-export.mjs'));
  });
};

describe('segment-export', () => {
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
   * Validates: Requirements 9.1, 9.2, 9.3
   */
  it('exports members with engagement data in correct JSON format', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        {
          tenantId: { S: 'tenant1' },
          email: { S: 'SEGMENT#seg1#MEMBER#active@test.com' },
          subscriberEmail: { S: 'active@test.com' },
        },
      ],
    });
    ddbSend.mockResolvedValueOnce({
      Responses: {
        'test-subscribers-table': [
          {
            tenantId: { S: 'tenant1' },
            email: { S: 'active@test.com' },
            lastEngagedIssue: { N: '10' },
            engagementCount: { N: '5' },
          },
        ],
      },
    });
    s3Send.mockResolvedValueOnce({});
    ddbSend.mockResolvedValueOnce({});

    const result = await handler({ tenantId: 'tenant1', segmentId: 'seg1', jobId: 'job1' });

    expect(result.s3Key).toBeDefined();
    expect(result.s3Key).toContain('reports/segment-export-tenant1-seg1-');

    const putCall = s3Send.mock.calls[0][0];
    const report = JSON.parse(putCall.Body);

    expect(report).toHaveLength(1);
    expect(report[0]).toEqual({
      email: 'active@test.com',
      lastEngagedIssue: 10,
      engagementCount: 5,
    });
  });

  /**
   * Validates: Requirements 9.1, 9.2, 9.3
   */
  it('outputs null for members without engagement fields', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        {
          tenantId: { S: 'tenant1' },
          email: { S: 'SEGMENT#seg1#MEMBER#nodata@test.com' },
          subscriberEmail: { S: 'nodata@test.com' },
        },
      ],
    });
    ddbSend.mockResolvedValueOnce({
      Responses: {
        'test-subscribers-table': [
          {
            tenantId: { S: 'tenant1' },
            email: { S: 'nodata@test.com' },
          },
        ],
      },
    });
    s3Send.mockResolvedValueOnce({});
    ddbSend.mockResolvedValueOnce({});

    await handler({ tenantId: 'tenant1', segmentId: 'seg1', jobId: 'job1' });

    const putCall = s3Send.mock.calls[0][0];
    const report = JSON.parse(putCall.Body);

    expect(report).toHaveLength(1);
    expect(report[0]).toEqual({
      email: 'nodata@test.com',
      lastEngagedIssue: null,
      engagementCount: null,
    });
  });

  /**
   * Validates: Requirements 9.1, 9.2, 9.3
   */
  it('outputs null when subscriber record is missing from BatchGetItem', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        {
          tenantId: { S: 'tenant1' },
          email: { S: 'SEGMENT#seg1#MEMBER#gone@test.com' },
          subscriberEmail: { S: 'gone@test.com' },
        },
      ],
    });
    ddbSend.mockResolvedValueOnce({
      Responses: { 'test-subscribers-table': [] },
    });
    s3Send.mockResolvedValueOnce({});
    ddbSend.mockResolvedValueOnce({});

    await handler({ tenantId: 'tenant1', segmentId: 'seg1', jobId: 'job1' });

    const putCall = s3Send.mock.calls[0][0];
    const report = JSON.parse(putCall.Body);

    expect(report).toHaveLength(1);
    expect(report[0]).toEqual({
      email: 'gone@test.com',
      lastEngagedIssue: null,
      engagementCount: null,
    });
  });

  /**
   * Validates: Requirements 9.1, 9.2
   */
  it('updates job record to completed on success', async () => {
    ddbSend.mockResolvedValueOnce({ Items: [] });
    s3Send.mockResolvedValueOnce({});
    ddbSend.mockResolvedValueOnce({});

    await handler({ tenantId: 'tenant1', segmentId: 'seg1', jobId: 'job1' });

    const updateCall = ddbSend.mock.calls[1][0];
    expect(updateCall.__type).toBe('Update');
    expect(updateCall.ExpressionAttributeValues[':status']).toEqual({ S: 'completed' });
    expect(updateCall.ExpressionAttributeValues[':s3Key']).toBeDefined();
  });

  /**
   * Validates: Requirements 9.1, 9.2
   */
  it('updates job record to failed on error', async () => {
    ddbSend.mockRejectedValueOnce(new Error('DynamoDB failure'));
    ddbSend.mockResolvedValueOnce({});

    await expect(handler({ tenantId: 'tenant1', segmentId: 'seg1', jobId: 'job1' }))
      .rejects.toThrow('DynamoDB failure');

    const updateCall = ddbSend.mock.calls[1][0];
    expect(updateCall.__type).toBe('Update');
    expect(updateCall.ExpressionAttributeValues[':status']).toEqual({ S: 'failed' });
    expect(updateCall.ExpressionAttributeValues[':error']).toBeDefined();
  });

  /**
   * Validates: Requirements 9.1, 9.2
   */
  it('handles segment with no members', async () => {
    ddbSend.mockResolvedValueOnce({ Items: [] });
    s3Send.mockResolvedValueOnce({});
    ddbSend.mockResolvedValueOnce({});

    const result = await handler({ tenantId: 'tenant1', segmentId: 'seg1', jobId: 'job1' });

    expect(result.s3Key).toBeDefined();

    const putCall = s3Send.mock.calls[0][0];
    const report = JSON.parse(putCall.Body);
    expect(report).toEqual([]);
  });
});
