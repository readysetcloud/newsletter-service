import { jest } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, GetItemCommand } = await import('@aws-sdk/client-dynamodb');

process.env.TABLE_NAME = 'test-newsletter-table';
process.env.SHORT_LINK_BASE = 'https://rdyset.click/c';

const { handler } = await import('../get-campaign-link.mjs');

describe('get-campaign-link', () => {
  let mockDdbSend;

  beforeEach(() => {
    mockDdbSend = jest.fn();
    DynamoDBClient.prototype.send = mockDdbSend;
    jest.clearAllMocks();
  });

  test('returns 400 when code is missing or malformed', async () => {
    expect((await handler({})).statusCode).toBe(400);
    expect((await handler({ pathParameters: { code: 'abc' } })).statusCode).toBe(400);
    expect((await handler({ pathParameters: { code: 'ABCDEFG' } })).statusCode).toBe(400);
  });

  test('returns 404 when not found', async () => {
    mockDdbSend.mockResolvedValueOnce({});
    const res = await handler({ pathParameters: { code: 'aB3xKp' } });
    expect(res.statusCode).toBe(404);
  });

  test('returns the link metadata', async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: marshall({
        pk: 'CAMPAIGN_LINK_CODE#aB3xKp',
        sk: 'METADATA',
        code: 'aB3xKp',
        url: 'https://example.com/post',
        src: 'linkedin',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2028-01-01T00:00:00.000Z',
      }),
    });

    const res = await handler({ pathParameters: { code: 'aB3xKp' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({
      code: 'aB3xKp',
      short_url: 'https://rdyset.click/c/aB3xKp',
      url: 'https://example.com/post',
      src: 'linkedin',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2028-01-01T00:00:00.000Z',
    });

    const ddbCmd = mockDdbSend.mock.calls[0][0];
    expect(ddbCmd).toBeInstanceOf(GetItemCommand);
    const key = unmarshall(ddbCmd.input.Key);
    expect(key.pk).toBe('CAMPAIGN_LINK_CODE#aB3xKp');
    expect(key.sk).toBe('METADATA');
  });
});
