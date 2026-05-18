import { jest } from '@jest/globals';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
const {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  DeleteKeyCommand,
} = await import('@aws-sdk/client-cloudfront-keyvaluestore');

process.env.TABLE_NAME = 'test-newsletter-table';
process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/abc';

const { handler } = await import('../delete-campaign-link.mjs');

describe('delete-campaign-link', () => {
  let mockDdbSend;
  let mockKvsSend;

  beforeEach(() => {
    mockDdbSend = jest.fn().mockResolvedValue({});
    mockKvsSend = jest.fn();
    DynamoDBClient.prototype.send = mockDdbSend;
    CloudFrontKeyValueStoreClient.prototype.send = mockKvsSend;
    jest.clearAllMocks();
  });

  test('returns 400 when code is missing', async () => {
    const res = await handler({});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/code/);
    expect(mockKvsSend).not.toHaveBeenCalled();
    expect(mockDdbSend).not.toHaveBeenCalled();
  });

  test('returns 400 when code is not exactly 6 alphanumeric chars', async () => {
    for (const bad of ['abc', 'abc-def', 'ABCDEFG', '12345']) {
      const res = await handler({ pathParameters: { code: bad } });
      expect(res.statusCode).toBe(400);
    }
    expect(mockKvsSend).not.toHaveBeenCalled();
  });

  test('happy path: deletes KVS key with current ETag then deletes Dynamo sentinel, returns 204', async () => {
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag-current' })
      .mockResolvedValueOnce({ ETag: 'etag-after' });

    const res = await handler({ pathParameters: { code: 'aB3xKp' } });
    expect(res.statusCode).toBe(204);

    const kvsCmds = mockKvsSend.mock.calls.map((c) => c[0]);
    expect(kvsCmds[0]).toBeInstanceOf(DescribeKeyValueStoreCommand);
    expect(kvsCmds[1]).toBeInstanceOf(DeleteKeyCommand);
    expect(kvsCmds[1].input.Key).toBe('aB3xKp');
    expect(kvsCmds[1].input.IfMatch).toBe('etag-current');

    expect(mockDdbSend).toHaveBeenCalledTimes(1);
    const ddbCmd = mockDdbSend.mock.calls[0][0];
    expect(ddbCmd).toBeInstanceOf(DeleteItemCommand);
    const key = unmarshall(ddbCmd.input.Key);
    expect(key.pk).toBe('CAMPAIGN_LINK_CODE#aB3xKp');
    expect(key.sk).toBe('CAMPAIGN_LINK_CODE#aB3xKp');
  });

  test('idempotent: KVS 404 still deletes Dynamo and returns 204', async () => {
    const notFound = Object.assign(new Error('not found'), {
      name: 'ResourceNotFoundException',
      $metadata: { httpStatusCode: 404 },
    });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag-current' })
      .mockRejectedValueOnce(notFound);

    const res = await handler({ pathParameters: { code: 'aB3xKp' } });
    expect(res.statusCode).toBe(204);
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
  });

  test('rethrows non-404 KVS errors', async () => {
    const fatal = Object.assign(new Error('boom'), { name: 'InternalServiceError' });
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag-current' })
      .mockRejectedValueOnce(fatal);

    await expect(handler({ pathParameters: { code: 'aB3xKp' } })).rejects.toThrow('boom');
    expect(mockDdbSend).not.toHaveBeenCalled();
  });
});
