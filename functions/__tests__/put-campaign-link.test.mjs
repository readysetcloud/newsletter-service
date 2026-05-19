import { jest } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb');
const {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
} = await import('@aws-sdk/client-cloudfront-keyvaluestore');

process.env.TABLE_NAME = 'test-newsletter-table';
process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/abc';
process.env.SHORT_LINK_BASE = 'https://rdyset.click/c';

const { handler } = await import('../put-campaign-link.mjs');

const validEvent = (body, code = 'aB3xKp') => ({
  pathParameters: { code },
  body: JSON.stringify(body),
});

describe('put-campaign-link', () => {
  let mockDdbSend;
  let mockKvsSend;

  beforeEach(() => {
    mockDdbSend = jest.fn();
    mockKvsSend = jest.fn();
    DynamoDBClient.prototype.send = mockDdbSend;
    CloudFrontKeyValueStoreClient.prototype.send = mockKvsSend;
    jest.clearAllMocks();
  });

  describe('validation', () => {
    test('returns 400 for malformed code', async () => {
      const res = await handler({ pathParameters: { code: 'abc' }, body: JSON.stringify({ url: 'https://x.com' }) });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for missing body', async () => {
      const res = await handler({ pathParameters: { code: 'aB3xKp' } });
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for missing url', async () => {
      const res = await handler(validEvent({}));
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for non-http url', async () => {
      const res = await handler(validEvent({ url: 'ftp://x.com' }));
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for url over 2048 chars', async () => {
      const longUrl = 'https://x.com/' + 'a'.repeat(2050);
      const res = await handler(validEvent({ url: longUrl }));
      expect(res.statusCode).toBe(400);
    });

    test('returns 400 for non-string src', async () => {
      const res = await handler(validEvent({ url: 'https://x.com', src: 42 }));
      expect(res.statusCode).toBe(400);
    });
  });

  describe('happy path', () => {
    test('updates Dynamo with ConditionExpression and writes new KVS value', async () => {
      mockDdbSend.mockResolvedValueOnce({
        Attributes: marshall({
          pk: 'CAMPAIGN_LINK_CODE#aB3xKp',
          sk: 'METADATA',
          code: 'aB3xKp',
          url: 'https://new.example.com/post',
          src: 'x',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-05-18T12:00:00.000Z',
          expiresAt: '2028-01-01T00:00:00.000Z',
        }),
      });
      mockKvsSend
        .mockResolvedValueOnce({ ETag: 'etag-current' })
        .mockResolvedValueOnce({});

      const res = await handler(validEvent({ url: 'https://new.example.com/post', src: 'x' }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.url).toBe('https://new.example.com/post');
      expect(body.src).toBe('x');
      expect(body.short_url).toBe('https://rdyset.click/c/aB3xKp');

      const updateCmd = mockDdbSend.mock.calls[0][0];
      expect(updateCmd).toBeInstanceOf(UpdateItemCommand);
      expect(updateCmd.input.ConditionExpression).toMatch(/attribute_exists/);
      const key = unmarshall(updateCmd.input.Key);
      expect(key.sk).toBe('METADATA');

      const kvsPut = mockKvsSend.mock.calls
        .map((c) => c[0])
        .find((c) => c instanceof PutKeyCommand);
      const kvsValue = JSON.parse(kvsPut.input.Value);
      expect(kvsValue).toEqual({ u: 'https://new.example.com/post', src: 'x' });
    });

    test('passes null src when not provided', async () => {
      mockDdbSend.mockResolvedValueOnce({
        Attributes: marshall({
          pk: 'CAMPAIGN_LINK_CODE#aB3xKp', sk: 'METADATA', code: 'aB3xKp',
          url: 'https://new.example.com',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-05-18T12:00:00.000Z',
          expiresAt: '2028-01-01T00:00:00.000Z',
        }),
      });
      mockKvsSend
        .mockResolvedValueOnce({ ETag: 'etag-current' })
        .mockResolvedValueOnce({});

      const res = await handler(validEvent({ url: 'https://new.example.com' }));
      expect(res.statusCode).toBe(200);

      const kvsPut = mockKvsSend.mock.calls
        .map((c) => c[0])
        .find((c) => c instanceof PutKeyCommand);
      const kvsValue = JSON.parse(kvsPut.input.Value);
      expect(kvsValue).toEqual({ u: 'https://new.example.com' });
    });
  });

  describe('not found', () => {
    test('returns 404 when ConditionalCheckFailedException', async () => {
      const notFound = Object.assign(new Error('no row'), { name: 'ConditionalCheckFailedException' });
      mockDdbSend.mockRejectedValueOnce(notFound);

      const res = await handler(validEvent({ url: 'https://new.example.com' }));
      expect(res.statusCode).toBe(404);
      expect(mockKvsSend).not.toHaveBeenCalled();
    });
  });
});
