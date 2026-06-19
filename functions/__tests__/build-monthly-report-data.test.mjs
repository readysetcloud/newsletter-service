import { jest } from '@jest/globals';
import { marshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
const { handler } = await import('../build-monthly-report-data.mjs');

const baseInput = {
  tenant: { id: 'tenant123', email: 'owner@example.com' },
  month: '2026-05',
  monthLabel: 'May 2026',
  periodStart: '2026-05-01T00:00:00.000Z',
  periodEnd: '2026-05-31T23:59:59.999Z'
};

// Two issues in May, one in April (out of window), one in June (out of window).
const issueItems = [
  { pk: 'tenant123#41', sk: 'stats', subject: 'April issue', publishedAt: '2026-04-15T10:00:00.000Z', deliveries: 900, sends: 950, opens: 400, bounces: 5, unsubscribes: 2, subscribers: 950, clicks_total: 80 },
  { pk: 'tenant123#42', sk: 'stats', subject: 'First May issue', publishedAt: '2026-05-06T10:00:00.000Z', deliveries: 1000, sends: 1010, opens: 500, bounces: 6, unsubscribes: 3, subscribers: 1000, clicks_total: 120 },
  { pk: 'tenant123#43', sk: 'stats', subject: 'Second May issue', publishedAt: '2026-05-20T10:00:00.000Z', deliveries: 1100, sends: 1110, opens: 700, bounces: 4, unsubscribes: 1, subscribers: 1100, clicks_total: 200 },
  { pk: 'tenant123#44', sk: 'stats', subject: 'June issue', publishedAt: '2026-06-02T10:00:00.000Z', deliveries: 1200, sends: 1210, opens: 800, bounces: 3, unsubscribes: 0, subscribers: 1200, clicks_total: 300 }
];

const linksByIssue = {
  'tenant123#42': [
    { pk: 'tenant123#42', sk: 'link#a', url: 'https://example.com/popular', clicks_total: 90 },
    { pk: 'tenant123#42', sk: 'link#b', url: 'https://example.com/other', clicks_total: 30 }
  ],
  'tenant123#43': [
    { pk: 'tenant123#43', sk: 'link#a', url: 'https://example.com/popular', clicks_total: 150 },
    { pk: 'tenant123#43', sk: 'link#c', url: 'https://example.com/third', clicks_total: 50 }
  ]
};

describe('build-monthly-report-data', () => {
  let mockSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn(async (command) => {
      const input = command.input;
      // GSI1 query for all tenant issues
      if (input.IndexName === 'GSI1') {
        return { Items: issueItems.map((i) => marshall(i)) };
      }
      // base-table link# query keyed by pk
      const pk = input.ExpressionAttributeValues[':pk'].S;
      return { Items: (linksByIssue[pk] || []).map((l) => marshall(l)) };
    });
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  test('aggregates only issues within the reporting window', async () => {
    const result = await handler(baseInput);

    expect(result.hasIssues).toBe(true);
    expect(result.reportData.summary.issuesSent).toBe(2);
    expect(result.reportData.issues.map((i) => i.issueNumber)).toEqual([42, 43]);
  });

  test('computes summary totals and averages', async () => {
    const { reportData } = await handler(baseInput);
    const s = reportData.summary;

    expect(s.totalDelivered).toBe(2100);
    expect(s.totalClicks).toBe(320); // 120 + 200 (from clicks_total)
    expect(s.totalBounces).toBe(10);
    expect(s.totalUnsubscribes).toBe(4);
    // avg open rate = uniqueOpens(1200) / delivered(2100) * 100
    expect(s.avgOpenRate).toBeCloseTo(57.14, 1);
  });

  test('returns top links by click count aggregated across issues', async () => {
    const { reportData } = await handler(baseInput);
    const top = reportData.topLinks;

    expect(top[0].url).toBe('https://example.com/popular');
    expect(top[0].clicks).toBe(240); // 90 + 150
    expect(top[0].issues.sort()).toEqual([42, 43]);
    expect(top.length).toBe(3);
  });

  test('derives subscriber growth from per-issue snapshots', async () => {
    const { reportData } = await handler(baseInput);
    const g = reportData.subscriberGrowth;

    expect(g.startCount).toBe(1000);
    expect(g.endCount).toBe(1100);
    expect(g.netChange).toBe(100);
    expect(g.growthRate).toBeCloseTo(10, 5);
    expect(g.byIssue).toHaveLength(2);
  });

  test('identifies best performing issues', async () => {
    const { reportData } = await handler(baseInput);
    expect(reportData.bestIssue.byClicks.issueNumber).toBe(43);
  });

  test('returns hasIssues=false when no issues fall in the window', async () => {
    mockSend = jest.fn(async () => ({ Items: [] }));
    DynamoDBClient.prototype.send = mockSend;

    const result = await handler(baseInput);
    expect(result.hasIssues).toBe(false);
    expect(result.reportData).toBeUndefined();
  });
});
