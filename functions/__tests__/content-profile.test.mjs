import { jest } from '@jest/globals';
import { marshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');

process.env.TABLE_NAME = 'test-newsletter-table';

const {
  MAX_ISSUE_DIGESTS,
  TOP_LINKS_PER_ISSUE,
  MAX_EXEMPLARS,
  loadContentProfile,
  digestFromLinkRecords,
  mergeIssueDigests,
  buildAggregates,
  formatProfileForPrompt
} = await import('../utils/content-profile.mjs');

const linkRecord = (overrides = {}) => ({
  pk: 'tenant1#42',
  sk: 'link#abc',
  url: 'https://example.com/a',
  position: 1,
  clicks_total: 10,
  primaryTopic: 'serverless',
  summary: 'A serverless article',
  ...overrides
});

describe('content-profile', () => {
  describe('digestFromLinkRecords', () => {
    test('aggregates topics with clicks and keeps the most-clicked links', async () => {
      const records = [
        linkRecord({ sk: 'link#1', url: 'https://a.com', clicks_total: 3, position: 1 }),
        linkRecord({ sk: 'link#2', url: 'https://b.com', clicks_total: 25, position: 2, primaryTopic: 'ai' }),
        linkRecord({ sk: 'link#3', url: 'https://c.com', clicks_total: 7, position: 3 }),
        linkRecord({ sk: 'link#4', url: 'https://d.com', clicks_total: 0, position: 4, primaryTopic: undefined, summary: undefined })
      ];

      const digest = digestFromLinkRecords(42, '2026-07-01T12:00:00.000Z', records);

      expect(digest.issueNumber).toBe(42);
      expect(digest.publishedAt).toBe('2026-07-01T12:00:00.000Z');
      expect(digest.linkCount).toBe(4);
      expect(digest.topics).toEqual({
        serverless: { featured: 2, clicks: 10 },
        ai: { featured: 1, clicks: 25 }
      });
      expect(digest.topLinks[0].url).toBe('https://b.com');
      expect(digest.topLinks[1].url).toBe('https://c.com');
      // unclassified link still appears in topLinks but has no topic fields
      expect(digest.topLinks[3]).toEqual({ url: 'https://d.com', clicks: 0 });
    });

    test('caps topLinks per issue', () => {
      const records = Array.from({ length: 10 }, (_, i) =>
        linkRecord({ sk: `link#${i}`, url: `https://example.com/${i}`, clicks_total: i, position: i + 1 }));

      const digest = digestFromLinkRecords(1, '2026-01-01T00:00:00.000Z', records);
      expect(digest.topLinks).toHaveLength(TOP_LINKS_PER_ISSUE);
    });

    test('returns null when there are no usable records', () => {
      expect(digestFromLinkRecords(1, '2026-01-01T00:00:00.000Z', [])).toBeNull();
      expect(digestFromLinkRecords(1, '2026-01-01T00:00:00.000Z', [{ sk: 'link#x' }])).toBeNull();
    });
  });

  describe('mergeIssueDigests', () => {
    const digest = (issueNumber) => ({ issueNumber, publishedAt: '2026-01-01T00:00:00.000Z', topics: {}, topLinks: [] });

    test('fresh digests override stored ones and old ones are retained', () => {
      const existing = { 40: { ...digest(40), linkCount: 5 }, 41: digest(41) };
      const fresh = { 41: { ...digest(41), linkCount: 9 }, 42: digest(42) };

      const merged = mergeIssueDigests(existing, fresh);

      expect(Object.keys(merged).sort()).toEqual(['40', '41', '42']);
      expect(merged['41'].linkCount).toBe(9);
      expect(merged['40'].linkCount).toBe(5);
    });

    test('keeps only the most recent issues', () => {
      const existing = Object.fromEntries(
        Array.from({ length: MAX_ISSUE_DIGESTS + 5 }, (_, i) => [String(i + 1), digest(i + 1)]));

      const merged = mergeIssueDigests(existing, {});

      expect(Object.keys(merged)).toHaveLength(MAX_ISSUE_DIGESTS);
      expect(merged['1']).toBeUndefined();
      expect(merged[String(MAX_ISSUE_DIGESTS + 5)]).toBeDefined();
    });
  });

  describe('buildAggregates', () => {
    test('sums topic weights and ranks exemplars by clicks', () => {
      const digests = {
        41: {
          issueNumber: 41,
          topics: { serverless: { featured: 2, clicks: 10 } },
          topLinks: [{ url: 'https://a.com', summary: 'A', clicks: 10 }]
        },
        42: {
          issueNumber: 42,
          topics: { serverless: { featured: 1, clicks: 5 }, ai: { featured: 3, clicks: 40 } },
          topLinks: [
            { url: 'https://b.com', summary: 'B', clicks: 40 },
            { url: 'https://c.com', summary: 'C', clicks: 2 }
          ]
        }
      };

      const { topicWeights, exemplars } = buildAggregates(digests);

      expect(topicWeights).toEqual({
        serverless: { featured: 3, clicks: 15 },
        ai: { featured: 3, clicks: 40 }
      });
      expect(exemplars.map(e => e.url)).toEqual(['https://b.com', 'https://a.com', 'https://c.com']);
      expect(exemplars[0].issueNumber).toBe(42);
    });

    test('caps exemplars', () => {
      const digests = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), {
        issueNumber: i,
        topics: {},
        topLinks: [
          { url: `https://a${i}.com`, clicks: i },
          { url: `https://b${i}.com`, clicks: i }
        ]
      }]));

      const { exemplars } = buildAggregates(digests);
      expect(exemplars).toHaveLength(MAX_EXEMPLARS);
    });
  });

  describe('formatProfileForPrompt', () => {
    test('returns null for missing or empty profiles', () => {
      expect(formatProfileForPrompt(null)).toBeNull();
      expect(formatProfileForPrompt({})).toBeNull();
      expect(formatProfileForPrompt({ topicWeights: {}, exemplars: [] })).toBeNull();
    });

    test('renders editorial summary, topics, and exemplars', () => {
      const text = formatProfileForPrompt({
        editorialProfile: {
          summary: 'Hands-on serverless content dominates.',
          patterns: ['tutorials outperform announcements'],
          issuesAnalyzed: 12
        },
        topicWeights: {
          serverless: { featured: 24, clicks: 310 },
          ai: { featured: 8, clicks: 90 }
        },
        exemplars: [
          { url: 'https://a.com', summary: 'Great Lambda tutorial', primaryTopic: 'serverless', clicks: 55, issueNumber: 40 }
        ]
      });

      expect(text).toContain('from 12 past issues');
      expect(text).toContain('Hands-on serverless content dominates.');
      expect(text).toContain('Pattern: tutorials outperform announcements');
      expect(text).toContain('serverless 24x/310 clicks');
      expect(text).toContain('Great Lambda tutorial (serverless, issue #40, 55 clicks)');
    });
  });

  describe('loadContentProfile', () => {
    let mockDdbSend;

    beforeEach(() => {
      mockDdbSend = jest.fn();
      DynamoDBClient.prototype.send = mockDdbSend;
    });

    test('loads the profile by tenant key', async () => {
      mockDdbSend.mockResolvedValue({ Item: marshall({ pk: 'tenant1', sk: 'content-profile', version: 1 }) });

      const profile = await loadContentProfile('tenant1');

      expect(profile.version).toBe(1);
      expect(mockDdbSend.mock.calls[0][0].input.Key).toEqual(marshall({ pk: 'tenant1', sk: 'content-profile' }));
    });

    test('returns null when missing or on error', async () => {
      mockDdbSend.mockResolvedValueOnce({});
      expect(await loadContentProfile('tenant1')).toBeNull();

      mockDdbSend.mockRejectedValueOnce(new Error('boom'));
      expect(await loadContentProfile('tenant1')).toBeNull();
    });
  });
});
