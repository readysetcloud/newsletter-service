import { jest } from '@jest/globals';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
const {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
} = await import('@aws-sdk/client-cloudfront-keyvaluestore');

process.env.TABLE_NAME = 'test-newsletter-table';
process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/abc';
process.env.SHORT_LINK_BASE = 'https://rdyset.click/c';

const { handler } = await import('../mint-campaign-link.mjs');

describe('mint-campaign-link', () => {
  let mockDdbSend;
  let mockKvsSend;

  beforeEach(() => {
    mockDdbSend = jest.fn();
    mockKvsSend = jest.fn();
    DynamoDBClient.prototype.send = mockDdbSend;
    CloudFrontKeyValueStoreClient.prototype.send = mockKvsSend;
    jest.clearAllMocks();
  });

  const invoke = (body) => handler({ body: typeof body === 'string' ? body : JSON.stringify(body) });

  describe('validation', () => {
    test('returns 400 when body is missing', async () => {
      const res = await handler({});
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/body/i);
    });

    test('returns 400 when body is invalid JSON', async () => {
      const res = await invoke('{not json');
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/JSON/i);
    });

    test('returns 400 when url is missing', async () => {
      const res = await invoke({ cid: 'x' });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/url/);
    });

    test('returns 400 when url is not http or https', async () => {
      const res = await invoke({ url: 'ftp://example.com' });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/http/);
    });

    test('returns 400 when url exceeds 2048 chars', async () => {
      const url = 'https://example.com/' + 'a'.repeat(2050);
      const res = await invoke({ url });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/2048/);
    });

    test('returns 400 when cid is not a string', async () => {
      const res = await invoke({ url: 'https://example.com', cid: 42 });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/cid/);
    });

    test('returns 400 when src is not a string', async () => {
      const res = await invoke({ url: 'https://example.com', src: { tag: 'linkedin' } });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/src/);
    });
  });

  describe('happy path', () => {
    test('mints code, writes KVS, returns wrapped URL', async () => {
      mockDdbSend.mockResolvedValue({});
      mockKvsSend
        .mockResolvedValueOnce({ ETag: 'etag-v1' })
        .mockResolvedValueOnce({});

      const res = await invoke({
        url: 'https://readysetcloud.io/some-post',
        cid: 'campaign#launch-2026#link#01HXYZ',
        src: 'linkedin',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.code).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(body.short_url).toBe(`https://rdyset.click/c/${body.code}`);

      expect(mockDdbSend).toHaveBeenCalledTimes(1);
      const ddbCmd = mockDdbSend.mock.calls[0][0];
      expect(ddbCmd).toBeInstanceOf(PutItemCommand);
      const item = unmarshall(ddbCmd.input.Item);
      expect(item.pk).toBe(`CAMPAIGN_LINK_CODE#${body.code}`);
      expect(item.sk).toBe(`CAMPAIGN_LINK_CODE#${body.code}`);
      expect(item.code).toBe(body.code);
      expect(ddbCmd.input.ConditionExpression).toContain('attribute_not_exists');

      const kvsCalls = mockKvsSend.mock.calls.map((c) => c[0]);
      expect(kvsCalls[0]).toBeInstanceOf(DescribeKeyValueStoreCommand);
      expect(kvsCalls[1]).toBeInstanceOf(PutKeyCommand);
      expect(kvsCalls[1].input.Key).toBe(body.code);
      expect(kvsCalls[1].input.IfMatch).toBe('etag-v1');
      const kvsValue = JSON.parse(kvsCalls[1].input.Value);
      expect(kvsValue).toEqual({
        u: 'https://readysetcloud.io/some-post',
        cid: 'campaign#launch-2026#link#01HXYZ',
        src: 'linkedin',
      });
    });

    test('omits cid and src from KVS value when not provided', async () => {
      mockDdbSend.mockResolvedValue({});
      mockKvsSend
        .mockResolvedValueOnce({ ETag: 'etag1' })
        .mockResolvedValueOnce({});

      const res = await invoke({ url: 'https://example.com' });
      expect(res.statusCode).toBe(200);

      const kvsPut = mockKvsSend.mock.calls[1][0];
      const kvsValue = JSON.parse(kvsPut.input.Value);
      expect(kvsValue).toEqual({ u: 'https://example.com' });
      expect(kvsValue).not.toHaveProperty('cid');
      expect(kvsValue).not.toHaveProperty('src');
    });

    test('accepts cid without src', async () => {
      mockDdbSend.mockResolvedValue({});
      mockKvsSend
        .mockResolvedValueOnce({ ETag: 'etag1' })
        .mockResolvedValueOnce({});

      await invoke({ url: 'https://example.com', cid: 'opaque-id' });

      const kvsValue = JSON.parse(mockKvsSend.mock.calls[1][0].input.Value);
      expect(kvsValue.cid).toBe('opaque-id');
      expect(kvsValue).not.toHaveProperty('src');
    });
  });

  describe('short-code allocation', () => {
    test('retries on collision then succeeds', async () => {
      const collision = Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
      mockDdbSend
        .mockRejectedValueOnce(collision)
        .mockRejectedValueOnce(collision)
        .mockResolvedValueOnce({});
      mockKvsSend
        .mockResolvedValueOnce({ ETag: 'etag1' })
        .mockResolvedValueOnce({});

      const res = await invoke({ url: 'https://example.com' });
      expect(res.statusCode).toBe(200);

      expect(mockDdbSend).toHaveBeenCalledTimes(3);
      const codes = mockDdbSend.mock.calls
        .map((c) => unmarshall(c[0].input.Item).code);
      expect(new Set(codes).size).toBe(3);
    });

    test('returns 503 when all retries exhausted', async () => {
      const collision = Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
      mockDdbSend.mockRejectedValue(collision);

      const res = await invoke({ url: 'https://example.com' });
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).message).toMatch(/unique/i);
      expect(mockKvsSend).not.toHaveBeenCalled();
    });

    test('rethrows non-conditional Dynamo errors', async () => {
      const fatal = Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' });
      mockDdbSend.mockRejectedValueOnce(fatal);

      await expect(invoke({ url: 'https://example.com' })).rejects.toThrow('throttled');
    });
  });
});
