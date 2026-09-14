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

  test('includes A/B test summaries for issues that ran a test', async () => {
    const abItems = [
      {
        pk: 'tenant123#43', sk: 'stats', subject: 'Second May issue',
        publishedAt: '2026-05-20T10:00:00.000Z', deliveries: 1100, sends: 1110,
        opens: 700, bounces: 4, unsubscribes: 1, subscribers: 1100, clicks_total: 200,
        analytics: {
          abTest: {
            dimension: 'subject',
            winMetric: 'openRate',
            status: 'sent',
            winnerVariantId: 'b',
            variants: [
              { variantId: 'a', subject: 'Control subject', opens: 300, clicks: 50, deliveries: 550, openRate: 54.5, clickRate: 9.1 },
              { variantId: 'b', subject: 'Challenger subject', opens: 400, clicks: 70, deliveries: 550, openRate: 72.7, clickRate: 12.7 }
            ],
            evaluation: { significant: true, confidence: 0.95 }
          }
        }
      }
    ];
    mockSend = jest.fn(async (command) => {
      const input = command.input;
      if (input.IndexName === 'GSI1') {
        return { Items: abItems.map((i) => marshall(i)) };
      }
      const pk = input.ExpressionAttributeValues[':pk'].S;
      return { Items: (linksByIssue[pk] || []).map((l) => marshall(l)) };
    });
    DynamoDBClient.prototype.send = mockSend;

    const { reportData } = await handler(baseInput);

    expect(reportData.abTests).toHaveLength(1);
    const test = reportData.abTests[0];
    expect(test.issueNumber).toBe('43');
    expect(test.dimension).toBe('subject');
    expect(test.winnerVariantId).toBe('b');
    expect(test.significant).toBe(true);
    expect(test.confidence).toBe(0.95);
    // lift = winner open rate (72.7) - control open rate (54.5)
    expect(test.lift).toBeCloseTo(18.2, 1);
    const winner = test.variants.find((v) => v.variantId === 'b');
    expect(winner.isWinner).toBe(true);
    expect(winner.label).toBe('Challenger subject');
  });

  test('omits abTests for issues without a test', async () => {
    const { reportData } = await handler(baseInput);
    expect(reportData.abTests).toEqual([]);
  });

  test('returns hasIssues=false when no issues fall in the window', async () => {
    mockSend = jest.fn(async () => ({ Items: [] }));
    DynamoDBClient.prototype.send = mockSend;

    const result = await handler(baseInput);
    expect(result.hasIssues).toBe(false);
    expect(result.reportData).toBeUndefined();
  });
});

/**
 * Issues that went missing from every report.
 *
 * A report picks its issues by reading `publishedAt` off the stats record, and
 * the window filter drops anything falsy — silently, with no error and no gap,
 * just a smaller number. In production three consecutive issues had stats
 * records carrying neither `publishedAt` nor `subject`: the two fields
 * `setupIssueStats` seeds, on records that only existed because the SES event
 * counters had created them. A month that sent five issues reported one.
 */
describe('build-monthly-report-data: stats records missing their seeded fields', () => {
  let mockSend;
  let originalEnv;
  let getItemKeys;

  /** The real shape: counters present, seeded fields absent. */
  const unseeded = (pk, over = {}) => ({
    pk,
    sk: 'stats',
    deliveries: 1000,
    sends: 1010,
    opens: 500,
    bounces: 6,
    unsubscribes: 3,
    subscribers: 1000,
    clicks_total: 120,
    ...over
  });

  const setup = ({ stats, issueRecords }) => {
    getItemKeys = [];
    mockSend = jest.fn(async (command) => {
      const input = command.input;

      if (input.IndexName === 'GSI1') {
        return { Items: stats.map((i) => marshall(i)) };
      }

      // The issue-record read the repair path makes.
      if (input.Key) {
        const pk = input.Key.pk.S;
        getItemKeys.push(pk);
        const record = issueRecords[pk];
        return record ? { Item: marshall(record) } : {};
      }

      return { Items: [] };
    });
    DynamoDBClient.prototype.send = mockSend;
  };

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  test('an issue whose stats lost their date still lands in the report', async () => {
    setup({
      stats: [unseeded('tenant123#42')],
      issueRecords: {
        'tenant123#42': { publishedAt: '2026-05-06T10:00:00.000Z', subject: 'Recovered issue' }
      }
    });

    const result = await handler(baseInput);

    expect(result.hasIssues).toBe(true);
    expect(result.reportData.summary.issuesSent).toBe(1);
  });

  test('and carries the subject the stats record never got', async () => {
    setup({
      stats: [unseeded('tenant123#42')],
      issueRecords: {
        'tenant123#42': { publishedAt: '2026-05-06T10:00:00.000Z', subject: 'Recovered issue' }
      }
    });

    const { reportData } = await handler(baseInput);

    expect(reportData.issues[0].subject).toBe('Recovered issue');
  });

  test('the window still applies to the recovered date', async () => {
    // Falling back must not drag in issues from outside the range.
    setup({
      stats: [unseeded('tenant123#41'), unseeded('tenant123#42')],
      issueRecords: {
        'tenant123#41': { publishedAt: '2026-04-15T10:00:00.000Z', subject: 'April' },
        'tenant123#42': { publishedAt: '2026-05-06T10:00:00.000Z', subject: 'May' }
      }
    });

    const { reportData } = await handler(baseInput);

    expect(reportData.issues.map((i) => i.issueNumber)).toEqual([42]);
  });

  test('the stats date wins wherever it exists', async () => {
    // It is the send instant; the issue record holds the earlier hand-off. This
    // is a repair for missing data, not a change of source.
    setup({
      stats: [unseeded('tenant123#42', {
        publishedAt: '2026-05-20T10:00:00.000Z',
        subject: 'From stats'
      })],
      issueRecords: {
        'tenant123#42': { publishedAt: '2026-05-06T10:00:00.000Z', subject: 'From issue record' }
      }
    });

    const { reportData } = await handler(baseInput);

    expect(reportData.issues[0].subject).toBe('From stats');
    expect(reportData.issues[0].publishedAt).toBe('2026-05-20T10:00:00.000Z');
  });

  test('reads nothing extra when every stats record is complete', async () => {
    setup({
      stats: [unseeded('tenant123#42', {
        publishedAt: '2026-05-06T10:00:00.000Z',
        subject: 'Complete'
      })],
      issueRecords: {}
    });

    await handler(baseInput);

    expect(getItemKeys).toEqual([]);
  });

  test('an issue record that cannot be found leaves the issue as it was', async () => {
    // Undated and therefore still outside every window — but the report is
    // built rather than failed.
    setup({ stats: [unseeded('tenant123#42')], issueRecords: {} });

    const result = await handler(baseInput);

    expect(result.hasIssues).toBe(false);
  });

  test('one unreadable issue record does not cost the rest of the report', async () => {
    setup({
      stats: [unseeded('tenant123#42'), unseeded('tenant123#43')],
      issueRecords: {
        'tenant123#43': { publishedAt: '2026-05-20T10:00:00.000Z', subject: 'Fine' }
      }
    });
    const good = mockSend;
    mockSend = jest.fn(async (command) => {
      if (command.input.Key?.pk?.S === 'tenant123#42') {
        throw new Error('Throughput exceeded');
      }
      return good(command);
    });
    DynamoDBClient.prototype.send = mockSend;

    const { reportData } = await handler(baseInput);

    expect(reportData.issues.map((i) => i.issueNumber)).toEqual([43]);
  });
});
