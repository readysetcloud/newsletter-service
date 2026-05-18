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
    });

    test('returns 400 when body is invalid JSON', async () => {
      const res = await invoke('{not json');
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 when url is missing', async () => {
      const res = await invoke({});
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(/url/);
    });

    test('returns 400 when url is not http or https', async () => {
      const res = await invoke({ url: 'ftp://example.com' });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 when url exceeds 2048 chars', async () => {
      const url = 'https://example.com/' + 'a'.repeat(2050);
      const res = await invoke({ url });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 when src is not a string', async () => {
      const res = await invoke({ url: 'https://example.com', src: { tag: 'linkedin' } });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for invalid expiresInDays', async () => {
      for (const bad of [0, -5, 3.14, 9999]) {
        const res = await invoke({ url: 'https://example.com', expiresInDays: bad });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).message).toMatch(/expiresInDays/);
      }
    });
  });

  describe('happy path', () => {
    test('mints code, writes KVS with {u, src}, returns wrapped URL with default 2y TTL', async () => {
      mockDdbSend.mockResolvedValue({});
      mockKvsSend
        .mockResolvedValueOnce({ ETag: 'etag-v1' })
        .mockResolvedValueOnce({});

      const before = Date.now();
      const res = await invoke({
        url: 'https://readysetcloud.io/some-post',
        src: 'linkedin',
      });
      const after = Date.now();

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.code).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(body.short_url).toBe(`https://rdyset.click/c/${body.code}`);

      const expiresAtMs = Date.parse(body.expires_at);
      const twoYearsMs = 730 * 86400 * 1000;
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + twoYearsMs - 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + twoYearsMs + 1000);

      const ddbCmd = mockDdbSend.mock.calls[0][0];
      expect(ddbCmd).toBeInstanceOf(PutItemCommand);
      const item = unmarshall(ddbCmd.input.Item);
      expect(item.pk).toBe(`CAMPAIGN_LINK_CODE#${body.code}`);
      expect(item.sk).toBe('METADATA');
      expect(item.entity).toBe('CampaignLink');
      expect(item.url).toBe('https://readysetcloud.io/some-post');
      expect(item.src).toBe('linkedin');
      expect(item.GSI1PK).toBe('CAMPAIGN_LINK_CODE_EXPIRY');
      expect(item.GSI1SK).toBe(body.expires_at);

      const kvsValue = JSON.parse(mockKvsSend.mock.calls[1][0].input.Value);
      expect(kvsValue).toEqual({ u: 'https://readysetcloud.io/some-post', src: 'linkedin' });
      expect(kvsValue).not.toHaveProperty('cid');
    });

    test('omits src from KVS value when not provided', async () => {
      mockDdbSend.mockResolvedValue({});
      mockKvsSend
        .mockResolvedValueOnce({ ETag: 'etag1' })
        .mockResolvedValueOnce({});

      await invoke({ url: 'https://example.com' });

      const kvsValue = JSON.parse(mockKvsSend.mock.calls[1][0].input.Value);
      expect(kvsValue).toEqual({ u: 'https://example.com' });
    });

    test('honors a custom expiresInDays', async () => {
      mockDdbSend.mockResolvedValue({});
      mockKvsSend
        .mockResolvedValueOnce({ ETag: 'etag1' })
        .mockResolvedValueOnce({});

      const before = Date.now();
      const res = await invoke({ url: 'https://example.com', expiresInDays: 30 });
      const after = Date.now();

      const body = JSON.parse(res.body);
      const expiresAtMs = Date.parse(body.expires_at);
      const thirtyDaysMs = 30 * 86400 * 1000;
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + thirtyDaysMs - 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + thirtyDaysMs + 1000);
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
    });

    test('returns 503 when all retries exhausted', async () => {
      const collision = Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
      mockDdbSend.mockRejectedValue(collision);

      const res = await invoke({ url: 'https://example.com' });
      expect(res.statusCode).toBe(503);
      expect(mockKvsSend).not.toHaveBeenCalled();
    });

    test('rethrows non-conditional Dynamo errors', async () => {
      const fatal = Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' });
      mockDdbSend.mockRejectedValueOnce(fatal);
      await expect(invoke({ url: 'https://example.com' })).rejects.toThrow('throttled');
    });
  });
});
