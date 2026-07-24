import { jest } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, QueryCommand, BatchWriteItemCommand, GetItemCommand } = await import('@aws-sdk/client-dynamodb');
const {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  DeleteKeyCommand,
} = await import('@aws-sdk/client-cloudfront-keyvaluestore');

process.env.TABLE_NAME = 'test-newsletter-table';
process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/abc';

const { handler } = await import('../delete-campaign-link.mjs');

const partitionRows = (code) => [
  marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'METADATA' }),
  marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'AGGREGATE' }),
  marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'CLICK#2026-05-01T00:00:00.000Z#01HXYZ' }),
];

const evt = (code, tenantId = 'tenant-1') => ({
  pathParameters: code === undefined ? undefined : { code },
  requestContext: { authorizer: { tenantId } },
});

// Metadata GetItem owned by the caller's tenant, so the ownership check passes.
const ownedMetadata = (code, tenantId = 'tenant-1') =>
  marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'METADATA', tenantId });

describe('delete-campaign-link', () => {
  let mockDdbSend;
  let mockKvsSend;

  beforeEach(() => {
    mockDdbSend = jest.fn();
    mockKvsSend = jest.fn();
    DynamoDBClient.prototype.send = mockDdbSend;
    CloudFrontKeyValueStoreClient.prototype.send = mockKvsSend;
    jest.clearAllMocks();
  });

  test('returns 401 when tenant is missing from authorizer context', async () => {
    const res = await handler({ pathParameters: { code: 'aB3xKp' } });
    expect(res.statusCode).toBe(401);
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockKvsSend).not.toHaveBeenCalled();
  });

  test('returns 400 when code is missing or malformed', async () => {
    const r1 = await handler(evt(undefined));
    expect(r1.statusCode).toBe(400);
    for (const bad of ['abc', 'abc-de', 'ABCDEFG']) {
      const r = await handler(evt(bad));
      expect(r.statusCode).toBe(400);
    }
    expect(mockKvsSend).not.toHaveBeenCalled();
    expect(mockDdbSend).not.toHaveBeenCalled();
  });

  test('returns 404 when the link belongs to another tenant', async () => {
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof GetItemCommand) {
        return Promise.resolve({ Item: ownedMetadata('aB3xKp', 'other-tenant') });
      }
      return Promise.resolve({});
    });

    const res = await handler(evt('aB3xKp'));
    expect(res.statusCode).toBe(404);
    // No destructive work when the caller doesn't own the link.
    expect(mockKvsSend).not.toHaveBeenCalled();
    const batches = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof BatchWriteItemCommand);
    expect(batches).toHaveLength(0);
  });

  test('happy path: deletes KVS then batch-deletes all partition items, returns 204', async () => {
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag-current' })
      .mockResolvedValueOnce({});
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof GetItemCommand) {
        return Promise.resolve({ Item: ownedMetadata('aB3xKp') });
      }
      if (cmd instanceof QueryCommand) {
        return Promise.resolve({ Items: partitionRows('aB3xKp') });
      }
      return Promise.resolve({});
    });

    const res = await handler(evt('aB3xKp'));
    expect(res.statusCode).toBe(204);

    const kvsCmds = mockKvsSend.mock.calls.map((c) => c[0]);
    expect(kvsCmds[0]).toBeInstanceOf(DescribeKeyValueStoreCommand);
    expect(kvsCmds[1]).toBeInstanceOf(DeleteKeyCommand);
    expect(kvsCmds[1].input.Key).toBe('aB3xKp');

    const queries = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof QueryCommand);
    expect(queries).toHaveLength(1);
    const queryValues = unmarshall(queries[0].input.ExpressionAttributeValues);
    expect(queryValues[':pk']).toBe('CAMPAIGN_LINK_CODE#aB3xKp');

    const batches = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof BatchWriteItemCommand);
    expect(batches).toHaveLength(1);
    const requests = batches[0].input.RequestItems[process.env.TABLE_NAME];
    expect(requests).toHaveLength(3);
    const sks = requests.map((r) => unmarshall(r.DeleteRequest.Key).sk);
    expect(sks).toEqual(expect.arrayContaining(['METADATA', 'AGGREGATE', expect.stringMatching(/^CLICK#/)]));
  });

  test('paginates partition deletes via LastEvaluatedKey', async () => {
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag0' })
      .mockResolvedValueOnce({});
    let queryCount = 0;
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof GetItemCommand) {
        return Promise.resolve({ Item: ownedMetadata('aB3xKp') });
      }
      if (cmd instanceof QueryCommand) {
        queryCount++;
        if (queryCount === 1) {
          return Promise.resolve({
            Items: [marshall({ pk: 'CAMPAIGN_LINK_CODE#aB3xKp', sk: 'METADATA' })],
            LastEvaluatedKey: { pk: { S: 'x' } },
          });
        }
        return Promise.resolve({
          Items: [marshall({ pk: 'CAMPAIGN_LINK_CODE#aB3xKp', sk: 'AGGREGATE' })],
        });
      }
      return Promise.resolve({});
    });

    await handler(evt('aB3xKp'));
    expect(queryCount).toBe(2);
  });

  test('idempotent: KVS 404 still deletes Dynamo partition and returns 204', async () => {
    const notFound = Object.assign(new Error('not found'), {
      name: 'ResourceNotFoundException',
      $metadata: { httpStatusCode: 404 },
    });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag-current' })
      .mockRejectedValueOnce(notFound);
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof GetItemCommand) {
        return Promise.resolve({ Item: ownedMetadata('aB3xKp') });
      }
      if (cmd instanceof QueryCommand) {
        return Promise.resolve({ Items: partitionRows('aB3xKp') });
      }
      return Promise.resolve({});
    });

    const res = await handler(evt('aB3xKp'));
    expect(res.statusCode).toBe(204);

    const batches = mockDdbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c instanceof BatchWriteItemCommand);
    expect(batches.length).toBeGreaterThan(0);
  });

  test('rethrows non-404 KVS errors', async () => {
    const fatal = Object.assign(new Error('boom'), { name: 'InternalServiceError' });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag-current' })
      .mockRejectedValueOnce(fatal);
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof GetItemCommand) {
        return Promise.resolve({ Item: ownedMetadata('aB3xKp') });
      }
      return Promise.resolve({});
    });

    await expect(handler(evt('aB3xKp'))).rejects.toThrow('boom');
  });
});
