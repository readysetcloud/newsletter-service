import { jest } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, QueryCommand, BatchGetItemCommand } = await import('@aws-sdk/client-dynamodb');

process.env.TABLE_NAME = 'test-newsletter-table';
process.env.SHORT_LINK_BASE = 'https://rdyset.click/c';

const { handler } = await import('../get-campaign-links-analytics.mjs');

describe('get-campaign-links-analytics', () => {
  let mockDdbSend;

  beforeEach(() => {
    mockDdbSend = jest.fn();
    DynamoDBClient.prototype.send = mockDdbSend;
    jest.clearAllMocks();
  });

  test('returns 400 when campaignId is missing or empty', async () => {
    expect((await handler({})).statusCode).toBe(400);
    expect((await handler({ pathParameters: { campaignId: '' } })).statusCode).toBe(400);
  });

  test('returns links with analytics and zeroes missing aggregates', async () => {
    mockDdbSend.mockImplementation((cmd) => {
      if (cmd instanceof QueryCommand) {
        return Promise.resolve({
          Items: [
            marshall({
              pk: 'CAMPAIGN_LINK_CODE#aB3xKp',
              sk: 'METADATA',
              code: 'aB3xKp',
              url: 'https://example.com/a',
              src: 'linkedin',
              campaignId: 'issue-123',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              expiresAt: '2028-01-01T00:00:00.000Z',
            }),
            marshall({
              pk: 'CAMPAIGN_LINK_CODE#zY8wQ2',
              sk: 'METADATA',
              code: 'zY8wQ2',
              url: 'https://example.com/b',
              campaignId: 'issue-123',
              createdAt: '2026-01-02T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
              expiresAt: '2028-01-02T00:00:00.000Z',
            }),
          ],
        });
      }
      if (cmd instanceof BatchGetItemCommand) {
        return Promise.resolve({
          Responses: {
            [process.env.TABLE_NAME]: [
              marshall({
                pk: 'CAMPAIGN_LINK_CODE#aB3xKp',
                sk: 'AGGREGATE',
                code: 'aB3xKp',
                totalClicks: 7,
                byDay: { '2026-05-26': 7 },
                bySrc: { linkedin: 7 },
                firstClickAt: '2026-05-26T10:00:00.000Z',
                lastClickAt: '2026-05-26T11:00:00.000Z',
              }),
            ],
          },
        });
      }
      return Promise.resolve({});
    });

    const res = await handler({ pathParameters: { campaignId: 'issue-123' } });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.campaign_id).toBe('issue-123');
    expect(body.total_links).toBe(2);
    expect(body.total_clicks).toBe(7);
    expect(body.links[0].analytics.total_clicks).toBe(7);
    expect(body.links[1].analytics).toEqual({
      code: 'zY8wQ2',
      total_clicks: 0,
      by_day: {},
      by_src: {},
      first_click_at: null,
      last_click_at: null,
    });

    const query = mockDdbSend.mock.calls[0][0];
    expect(query).toBeInstanceOf(QueryCommand);
    expect(query.input.IndexName).toBe('GSI2');
    const values = unmarshall(query.input.ExpressionAttributeValues);
    expect(values[':campaign']).toBe('CAMPAIGN_LINK_CAMPAIGN#issue-123');
  });
});
