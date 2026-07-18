import { jest } from '@jest/globals';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';

let computeInterestComposition;
let buildInterestCompositionLines;
let mockSend;

beforeEach(async () => {
  mockSend = jest.fn().mockResolvedValue({ Items: [] });
  DynamoDBClient.prototype.send = mockSend;
  jest.clearAllMocks();

  const mod = await import('../interest-composition.mjs');
  computeInterestComposition = mod.computeInterestComposition;
  buildInterestCompositionLines = mod.buildInterestCompositionLines;
});

const tenantId = 'tenant-1';

function subscriberItem(email, interestScores = {}) {
  return marshall({ tenantId, email, interestScores }, { removeUndefinedValues: true });
}

describe('computeInterestComposition', () => {
  test('queries the subscribers table by tenantId', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await computeInterestComposition(tenantId);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(QueryCommand);
    expect(cmd.input.TableName).toBe('test-subscribers-table');
    const values = unmarshall(cmd.input.ExpressionAttributeValues);
    expect(values[':tenantId']).toBe(tenantId);
  });

  test('returns zero totals and empty topics when there are no subscribers', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await computeInterestComposition(tenantId);

    expect(result).toEqual({ totalSubscribers: 0, topics: [] });
  });

  test('counts confirmed (score >= threshold) and engaged (score > 0) subscribers per topic', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        subscriberItem('a@test.com', { ai: { score: 4, lastScoredAt: '2026-01-01T00:00:00Z' } }),
        subscriberItem('b@test.com', { ai: { score: 3, lastScoredAt: '2026-01-01T00:00:00Z' } }),
        subscriberItem('c@test.com', { ai: { score: 1, lastScoredAt: '2026-01-01T00:00:00Z' } }),
        subscriberItem('d@test.com', { ai: { score: 0, lastScoredAt: '2026-01-01T00:00:00Z' } }),
        subscriberItem('e@test.com', {})
      ]
    });

    const result = await computeInterestComposition(tenantId);

    expect(result.totalSubscribers).toBe(5);
    const ai = result.topics.find(t => t.topic === 'ai');
    expect(ai).toBeDefined();
    expect(ai.displayName).toBe('AI');
    // a and b are >= 3 (AUTO_SEGMENT_THRESHOLD)
    expect(ai.confirmed).toBe(2);
    // a, b, c all have score > 0
    expect(ai.engaged).toBe(3);
    expect(ai.confirmedPct).toBe(40.0); // 2/5
    expect(ai.engagedPct).toBe(60.0); // 3/5
  });

  test('filters out SEGMENT infrastructure rows from totals and scoring', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        subscriberItem('real@test.com', { serverless: { score: 5, lastScoredAt: '2026-01-01T00:00:00Z' } }),
        marshall({ tenantId, email: 'SEGMENT#seg1', name: 'Auto: Serverless', autoManaged: true }),
        marshall({ tenantId, email: 'SEGMENT#seg1#MEMBER#real@test.com' }),
        marshall({ tenantId, email: 'SEGMENT_NAME#auto: serverless', segmentId: 'seg1' }),
        marshall({ tenantId, email: 'SEGMENT_JOB#job1', status: 'completed' })
      ]
    });

    const result = await computeInterestComposition(tenantId);

    expect(result.totalSubscribers).toBe(1);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].topic).toBe('serverless');
    expect(result.topics[0].confirmed).toBe(1);
  });

  test('omits topics with zero engaged subscribers', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        subscriberItem('a@test.com', { ai: { score: 2, lastScoredAt: '2026-01-01T00:00:00Z' } })
      ]
    });

    const result = await computeInterestComposition(tenantId);

    // Only 'ai' has engagement; the other 11 taxonomy topics should be absent
    expect(result.topics).toHaveLength(1);
    expect(result.topics.map(t => t.topic)).toEqual(['ai']);
  });

  test('ignores unknown/invalid topic keys not in the taxonomy', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        subscriberItem('a@test.com', { 'not-a-real-topic': { score: 10, lastScoredAt: '2026-01-01T00:00:00Z' } })
      ]
    });

    const result = await computeInterestComposition(tenantId);

    expect(result.totalSubscribers).toBe(1);
    expect(result.topics).toHaveLength(0);
  });

  test('sorts topics by confirmed count descending, tie-broken by engaged', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        subscriberItem('a@test.com', {
          ai: { score: 4, lastScoredAt: '2026-01-01T00:00:00Z' },
          devops: { score: 4, lastScoredAt: '2026-01-01T00:00:00Z' }
        }),
        subscriberItem('b@test.com', {
          ai: { score: 4, lastScoredAt: '2026-01-01T00:00:00Z' },
          security: { score: 1, lastScoredAt: '2026-01-01T00:00:00Z' }
        }),
        subscriberItem('c@test.com', {
          devops: { score: 4, lastScoredAt: '2026-01-01T00:00:00Z' },
          security: { score: 1, lastScoredAt: '2026-01-01T00:00:00Z' }
        })
      ]
    });

    const result = await computeInterestComposition(tenantId);
    const order = result.topics.map(t => t.topic);

    // ai: confirmed=2, devops: confirmed=2 (engaged=2 each too — order among tie is stable Map order: ai before devops)
    // security: confirmed=0, engaged=2
    expect(order[0]).toMatch(/ai|devops/);
    expect(order[1]).toMatch(/ai|devops/);
    expect(order[2]).toBe('security');
    expect(result.topics.find(t => t.topic === 'security').confirmed).toBe(0);
    expect(result.topics.find(t => t.topic === 'security').engaged).toBe(2);
  });

  test('paginates through multiple pages using LastEvaluatedKey', async () => {
    const page1Key = { tenantId: { S: tenantId }, email: { S: 'a@test.com' } };
    mockSend
      .mockResolvedValueOnce({
        Items: [subscriberItem('a@test.com', { ai: { score: 3, lastScoredAt: '2026-01-01T00:00:00Z' } })],
        LastEvaluatedKey: page1Key
      })
      .mockResolvedValueOnce({
        Items: [subscriberItem('b@test.com', { ai: { score: 3, lastScoredAt: '2026-01-01T00:00:00Z' } })]
      });

    const result = await computeInterestComposition(tenantId);

    expect(mockSend).toHaveBeenCalledTimes(2);
    const secondCmd = mockSend.mock.calls[1][0];
    expect(secondCmd.input.ExclusiveStartKey).toEqual(page1Key);
    expect(result.totalSubscribers).toBe(2);
    expect(result.topics.find(t => t.topic === 'ai').confirmed).toBe(2);
  });

  test('rounds percentages to 1 decimal place', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        subscriberItem('a@test.com', { ai: { score: 3, lastScoredAt: '2026-01-01T00:00:00Z' } }),
        subscriberItem('b@test.com', {}),
        subscriberItem('c@test.com', {})
      ]
    });

    const result = await computeInterestComposition(tenantId);
    const ai = result.topics.find(t => t.topic === 'ai');

    // 1/3 = 33.333...% -> rounds to 33.3
    expect(ai.confirmedPct).toBe(33.3);
  });

  test('treats missing/undefined interestScores as no engagement', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [marshall({ tenantId, email: 'a@test.com' })]
    });

    const result = await computeInterestComposition(tenantId);

    expect(result.totalSubscribers).toBe(1);
    expect(result.topics).toEqual([]);
  });
});

describe('buildInterestCompositionLines', () => {
  test('returns an empty array for null/undefined composition', () => {
    expect(buildInterestCompositionLines(null)).toEqual([]);
    expect(buildInterestCompositionLines(undefined)).toEqual([]);
  });

  test('returns an empty array when there are no topics', () => {
    expect(buildInterestCompositionLines({ totalSubscribers: 10, topics: [] })).toEqual([]);
  });

  test('formats each topic with display name, confirmed pct, and counts', () => {
    const composition = {
      totalSubscribers: 100,
      topics: [
        { topic: 'ai', displayName: 'AI', confirmed: 34, confirmedPct: 34.0, engaged: 50, engagedPct: 50.0 }
      ]
    };
    const lines = buildInterestCompositionLines(composition);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('AI');
    expect(lines[0]).toContain('34%');
    expect(lines[0]).toContain('34 of 100 subscribers');
  });

  test('limits to the top N topics (default 5)', () => {
    const topics = Array.from({ length: 8 }, (_, i) => ({
      topic: `topic${i}`, displayName: `Topic ${i}`, confirmed: 8 - i, confirmedPct: 8 - i, engaged: 8 - i, engagedPct: 8 - i
    }));
    const lines = buildInterestCompositionLines({ totalSubscribers: 100, topics });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('Topic 0');
    expect(lines[4]).toContain('Topic 4');
  });

  test('respects a custom limit', () => {
    const topics = Array.from({ length: 8 }, (_, i) => ({
      topic: `topic${i}`, displayName: `Topic ${i}`, confirmed: 8 - i, confirmedPct: 8 - i, engaged: 8 - i, engagedPct: 8 - i
    }));
    const lines = buildInterestCompositionLines({ totalSubscribers: 100, topics }, 3);
    expect(lines).toHaveLength(3);
  });
});
