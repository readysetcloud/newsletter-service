import { jest } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, GetItemCommand } = await import('@aws-sdk/client-dynamodb');

process.env.TABLE_NAME = 'test-newsletter-table';

const { handler } = await import('../get-campaign-link-analytics.mjs');

describe('get-campaign-link-analytics', () => {
  let mockDdbSend;

  beforeEach(() => {
    mockDdbSend = jest.fn();
    DynamoDBClient.prototype.send = mockDdbSend;
    jest.clearAllMocks();
  });

  test('returns 400 for malformed code', async () => {
    const res = await handler({ pathParameters: { code: 'abc' } });
    expect(res.statusCode).toBe(400);
  });

  test('returns zeroed analytics when no AGGREGATE row exists', async () => {
    mockDdbSend.mockResolvedValueOnce({});
    const res = await handler({ pathParameters: { code: 'aB3xKp' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      code: 'aB3xKp',
      total_clicks: 0,
      by_day: {},
      by_src: {},
      first_click_at: null,
      last_click_at: null,
    });
  });

  test('returns aggregate fields when row exists', async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: marshall({
        pk: 'CAMPAIGN_LINK_CODE#aB3xKp',
        sk: 'AGGREGATE',
        code: 'aB3xKp',
        totalClicks: 42,
        byDay: { '2026-05-17': 10, '2026-05-18': 32 },
        bySrc: { linkedin: 30, web: 12 },
        firstClickAt: '2026-05-17T08:00:00.000Z',
        lastClickAt: '2026-05-18T23:11:00.000Z',
      }),
    });

    const res = await handler({ pathParameters: { code: 'aB3xKp' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('aB3xKp');
    expect(body.total_clicks).toBe(42);
    expect(body.by_day).toEqual({ '2026-05-17': 10, '2026-05-18': 32 });
    expect(body.by_src).toEqual({ linkedin: 30, web: 12 });
    expect(body.first_click_at).toBe('2026-05-17T08:00:00.000Z');
    expect(body.last_click_at).toBe('2026-05-18T23:11:00.000Z');

    const key = unmarshall(mockDdbSend.mock.calls[0][0].input.Key);
    expect(key.sk).toBe('AGGREGATE');
  });
});
