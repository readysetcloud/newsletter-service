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

  const evt = (pathParameters, tenantId = 'tenant-1') => ({
    pathParameters,
    requestContext: { authorizer: { tenantId } },
  });

  // The handler reads METADATA (ownership) and AGGREGATE (data) in parallel;
  // route each GetItem by its sort key.
  const mockGets = ({ metadata, aggregate } = {}) => {
    mockDdbSend.mockImplementation((cmd) => {
      const sk = unmarshall(cmd.input.Key).sk;
      if (sk === 'METADATA') return Promise.resolve(metadata ?? {});
      if (sk === 'AGGREGATE') return Promise.resolve(aggregate ?? {});
      return Promise.resolve({});
    });
  };

  const ownedMeta = { Item: marshall({ pk: 'CAMPAIGN_LINK_CODE#aB3xKp', sk: 'METADATA', tenantId: 'tenant-1' }) };

  test('returns 401 when tenant is missing from authorizer context', async () => {
    const res = await handler({ pathParameters: { code: 'aB3xKp' } });
    expect(res.statusCode).toBe(401);
    expect(mockDdbSend).not.toHaveBeenCalled();
  });

  test('returns 400 for malformed code', async () => {
    const res = await handler(evt({ code: 'abc' }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when the link belongs to another tenant', async () => {
    mockGets({
      metadata: { Item: marshall({ pk: 'CAMPAIGN_LINK_CODE#aB3xKp', sk: 'METADATA', tenantId: 'other-tenant' }) },
      aggregate: { Item: marshall({ pk: 'CAMPAIGN_LINK_CODE#aB3xKp', sk: 'AGGREGATE', code: 'aB3xKp', totalClicks: 99 }) },
    });
    const res = await handler(evt({ code: 'aB3xKp' }));
    expect(res.statusCode).toBe(404);
  });

  test('returns zeroed analytics when no AGGREGATE row exists', async () => {
    mockGets({ metadata: ownedMeta });
    const res = await handler(evt({ code: 'aB3xKp' }));
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
    mockGets({
      metadata: ownedMeta,
      aggregate: {
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
      },
    });

    const res = await handler(evt({ code: 'aB3xKp' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('aB3xKp');
    expect(body.total_clicks).toBe(42);
    expect(body.by_day).toEqual({ '2026-05-17': 10, '2026-05-18': 32 });
    expect(body.by_src).toEqual({ linkedin: 30, web: 12 });
    expect(body.first_click_at).toBe('2026-05-17T08:00:00.000Z');
    expect(body.last_click_at).toBe('2026-05-18T23:11:00.000Z');
  });
});
