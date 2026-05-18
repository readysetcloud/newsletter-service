import { jest } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, QueryCommand, DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
const {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  DeleteKeyCommand,
} = await import('@aws-sdk/client-cloudfront-keyvaluestore');

process.env.TABLE_NAME = 'test-newsletter-table';
process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/abc';

const { handler } = await import('../sweep-expired-links.mjs');

const expiredRow = (code, expiresAt = '2020-01-01T00:00:00.000Z') => marshall({
  pk: `CAMPAIGN_LINK_CODE#${code}`,
  sk: `CAMPAIGN_LINK_CODE#${code}`,
  GSI1PK: 'CAMPAIGN_LINK_CODE_EXPIRY',
  GSI1SK: expiresAt,
  code,
  expiresAt,
});

describe('sweep-expired-links', () => {
  let mockDdbSend;
  let mockKvsSend;

  beforeEach(() => {
    mockDdbSend = jest.fn();
    mockKvsSend = jest.fn();
    DynamoDBClient.prototype.send = mockDdbSend;
    CloudFrontKeyValueStoreClient.prototype.send = mockKvsSend;
    jest.clearAllMocks();
  });

  test('queries GSI1 with the expected key condition', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    mockKvsSend.mockResolvedValueOnce({ ETag: 'etag0' });

    await handler();

    const queryCmd = mockDdbSend.mock.calls.find((c) => c[0] instanceof QueryCommand)[0];
    expect(queryCmd.input.IndexName).toBe('GSI1');
    expect(queryCmd.input.KeyConditionExpression).toBe('GSI1PK = :pk AND GSI1SK < :now');
    const values = unmarshall(queryCmd.input.ExpressionAttributeValues);
    expect(values[':pk']).toBe('CAMPAIGN_LINK_CODE_EXPIRY');
    expect(typeof values[':now']).toBe('string');
  });

  test('deletes KVS then Dynamo for each expired row and chains ETags', async () => {
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof QueryCommand) {
        return Promise.resolve({ Items: [expiredRow('AAA111'), expiredRow('BBB222')] });
      }
      return Promise.resolve({});
    });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag0' })
      .mockResolvedValueOnce({ ETag: 'etag1' })
      .mockResolvedValueOnce({ ETag: 'etag2' });

    const result = await handler();
    expect(result.deleted).toBe(2);
    expect(result.kvsMissing).toBe(0);
    expect(result.failed).toBe(0);

    const kvsDeletes = mockKvsSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof DeleteKeyCommand);
    expect(kvsDeletes).toHaveLength(2);
    expect(kvsDeletes[0].input.Key).toBe('AAA111');
    expect(kvsDeletes[0].input.IfMatch).toBe('etag0');
    expect(kvsDeletes[1].input.Key).toBe('BBB222');
    expect(kvsDeletes[1].input.IfMatch).toBe('etag1');

    const ddbDeletes = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof DeleteItemCommand);
    expect(ddbDeletes).toHaveLength(2);
    const keys = ddbDeletes.map((c) => unmarshall(c.input.Key).pk);
    expect(keys).toEqual(['CAMPAIGN_LINK_CODE#AAA111', 'CAMPAIGN_LINK_CODE#BBB222']);
  });

  test('paginates via LastEvaluatedKey', async () => {
    let queryCount = 0;
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof QueryCommand) {
        queryCount++;
        if (queryCount === 1) {
          return Promise.resolve({
            Items: [expiredRow('AAA111')],
            LastEvaluatedKey: { pk: { S: 'x' } },
          });
        }
        return Promise.resolve({ Items: [expiredRow('BBB222')] });
      }
      return Promise.resolve({});
    });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag0' })
      .mockResolvedValueOnce({ ETag: 'etag1' })
      .mockResolvedValueOnce({ ETag: 'etag2' });

    const result = await handler();
    expect(queryCount).toBe(2);
    expect(result.deleted).toBe(2);
  });

  test('treats KVS 404 as already-gone and still deletes the sentinel', async () => {
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof QueryCommand) {
        return Promise.resolve({ Items: [expiredRow('GHOST1')] });
      }
      return Promise.resolve({});
    });
    const notFound = Object.assign(new Error('not found'), {
      name: 'ResourceNotFoundException',
      $metadata: { httpStatusCode: 404 },
    });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag0' })
      .mockRejectedValueOnce(notFound);

    const result = await handler();
    expect(result.deleted).toBe(0);
    expect(result.kvsMissing).toBe(1);
    expect(result.failed).toBe(0);

    const ddbDeletes = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof DeleteItemCommand);
    expect(ddbDeletes).toHaveLength(1);
  });

  test('refreshes ETag and retries once on PreconditionFailedException', async () => {
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof QueryCommand) {
        return Promise.resolve({ Items: [expiredRow('AAA111')] });
      }
      return Promise.resolve({});
    });
    const stale = Object.assign(new Error('stale'), { name: 'PreconditionFailedException' });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag0' })
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce({ ETag: 'etag-fresh' })
      .mockResolvedValueOnce({ ETag: 'etag-after' });

    const result = await handler();
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);

    const describes = mockKvsSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof DescribeKeyValueStoreCommand);
    expect(describes).toHaveLength(2);
  });

  test('counts fatal errors as failed without throwing', async () => {
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof QueryCommand) {
        return Promise.resolve({ Items: [expiredRow('AAA111')] });
      }
      return Promise.resolve({});
    });
    const fatal = Object.assign(new Error('boom'), { name: 'InternalServiceError' });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag0' })
      .mockRejectedValueOnce(fatal);

    const result = await handler();
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(1);
  });

  test('skips rows missing a code field', async () => {
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof QueryCommand) {
        const malformed = marshall({
          pk: 'CAMPAIGN_LINK_CODE#WEIRD',
          sk: 'CAMPAIGN_LINK_CODE#WEIRD',
          GSI1PK: 'CAMPAIGN_LINK_CODE_EXPIRY',
          GSI1SK: '2020-01-01T00:00:00.000Z',
        });
        return Promise.resolve({ Items: [malformed] });
      }
      return Promise.resolve({});
    });
    mockKvsSend.mockResolvedValueOnce({ ETag: 'etag0' });

    const result = await handler();
    expect(result.deleted).toBe(0);
    expect(result.kvsMissing).toBe(0);
    expect(result.failed).toBe(0);
  });
});
