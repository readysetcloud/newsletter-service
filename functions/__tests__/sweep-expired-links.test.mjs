import { jest } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, QueryCommand, BatchWriteItemCommand } = await import('@aws-sdk/client-dynamodb');
const {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  DeleteKeyCommand,
} = await import('@aws-sdk/client-cloudfront-keyvaluestore');

process.env.TABLE_NAME = 'test-newsletter-table';
process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/abc';

const { handler } = await import('../sweep-expired-links.mjs');

const expiredSentinel = (code, expiresAt = '2020-01-01T00:00:00.000Z') => marshall({
  pk: `CAMPAIGN_LINK_CODE#${code}`,
  sk: 'METADATA',
  GSI1PK: 'CAMPAIGN_LINK_CODE_EXPIRY',
  GSI1SK: expiresAt,
  code,
  expiresAt,
});

const partitionMembers = (code) => [
  marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'METADATA' }),
  marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'AGGREGATE' }),
];

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

  function setupHappyPath(codes) {
    let gsiQueried = false;
    const partitionState = new Map(codes.map((c) => [c, partitionMembers(c)]));

    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof QueryCommand) {
        const isGsi = cmd.input.IndexName === 'GSI1';
        if (isGsi) {
          if (gsiQueried) return Promise.resolve({ Items: [] });
          gsiQueried = true;
          return Promise.resolve({ Items: codes.map((c) => expiredSentinel(c)) });
        }
        const pk = unmarshall(cmd.input.ExpressionAttributeValues)[':pk'];
        const code = pk.replace('CAMPAIGN_LINK_CODE#', '');
        return Promise.resolve({ Items: partitionState.get(code) || [] });
      }
      if (cmd instanceof BatchWriteItemCommand) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
  }

  test('queries GSI1 with the expected key condition', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    mockKvsSend.mockResolvedValueOnce({ ETag: 'etag0' });

    await handler();

    const queryCmd = mockDdbSend.mock.calls.find((c) => c[0] instanceof QueryCommand)[0];
    expect(queryCmd.input.IndexName).toBe('GSI1');
    expect(queryCmd.input.KeyConditionExpression).toBe('GSI1PK = :pk AND GSI1SK < :now');
    const values = unmarshall(queryCmd.input.ExpressionAttributeValues);
    expect(values[':pk']).toBe('CAMPAIGN_LINK_CODE_EXPIRY');
  });

  test('deletes KVS then batch-deletes the partition for each expired code', async () => {
    setupHappyPath(['AAA111', 'BBB222']);
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
    expect(kvsDeletes[1].input.IfMatch).toBe('etag1');

    const batches = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof BatchWriteItemCommand);
    expect(batches).toHaveLength(2);
  });

  test('treats KVS 404 as already-gone and still wipes the partition', async () => {
    setupHappyPath(['GHOST1']);
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

    const batches = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof BatchWriteItemCommand);
    expect(batches).toHaveLength(1);
  });

  test('refreshes ETag on PreconditionFailedException and retries', async () => {
    setupHappyPath(['AAA111']);
    const stale = Object.assign(new Error('stale'), { name: 'PreconditionFailedException' });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag0' })
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce({ ETag: 'etag-fresh' })
      .mockResolvedValueOnce({ ETag: 'etag-after' });

    const result = await handler();
    expect(result.deleted).toBe(1);

    const describes = mockKvsSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof DescribeKeyValueStoreCommand);
    expect(describes).toHaveLength(2);
  });

  test('counts fatal errors as failed without throwing', async () => {
    setupHappyPath(['AAA111']);
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
        return Promise.resolve({
          Items: [marshall({
            pk: 'CAMPAIGN_LINK_CODE#WEIRD',
            sk: 'METADATA',
            GSI1PK: 'CAMPAIGN_LINK_CODE_EXPIRY',
            GSI1SK: '2020-01-01T00:00:00.000Z',
          })],
        });
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
