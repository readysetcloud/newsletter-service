import * as fc from 'fast-check';
import { jest } from '@jest/globals';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { getMostRecentPublishedIssue } from '../utils/issue-attribution.mjs';

/**
 * Feature: issue-subscriber-metrics
 * Property 1: Attribution lookup returns the highest-numbered published issue
 *
 * **Validates: Requirements 1.4, 2.3, 5.1, 5.2**
 *
 * For any tenant with a set of issue records (some with `publishedAt` defined,
 * some without), the attribution lookup SHALL return the issue with the highest
 * issue number among those that have a `publishedAt` timestamp. If no issues
 * have `publishedAt`, the lookup SHALL return null.
 */

/**
 * Arbitrary: generates a single issue record with a random issue number
 * and random presence/absence of publishedAt.
 */
const arbIssueRecord = (tenantId) =>
  fc.record({
    issueNumber: fc.integer({ min: 1, max: 10000 }),
    hasPublishedAt: fc.boolean()
  }).map(({ issueNumber, hasPublishedAt }) => {
    const item = {
      pk: `${tenantId}#${issueNumber}`,
      GSI1PK: `${tenantId}#issue`,
      GSI1SK: String(issueNumber).padStart(5, '0'),
      issueNumber
    };
    if (hasPublishedAt) {
      item.publishedAt = '2025-01-01T00:00:00.000Z';
    }
    return item;
  });

/**
 * Arbitrary: generates an array of issue records with unique issue numbers.
 */
const arbIssueRecords = (tenantId) =>
  fc.uniqueArray(arbIssueRecord(tenantId), {
    minLength: 0,
    maxLength: 30,
    comparator: (a, b) => a.issueNumber === b.issueNumber
  });

/**
 * Helper: simulates the DynamoDB GSI1 query behavior.
 * Items are sorted by GSI1SK descending (highest issue number first),
 * returned in pages of PAGE_SIZE, with no FilterExpression applied server-side
 * (the function filters client-side for publishedAt).
 */
function mockDdbForRecords(records, mockSend) {
  const PAGE_SIZE = 10;
  // Sort descending by issue number (same as GSI1 ScanIndexForward=false)
  const sorted = [...records].sort((a, b) => b.issueNumber - a.issueNumber);
  const marshalledItems = sorted.map(r => marshall(r));

  let callIndex = 0;
  mockSend.mockImplementation(() => {
    const start = callIndex * PAGE_SIZE;
    const pageItems = marshalledItems.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < marshalledItems.length;
    callIndex++;

    return Promise.resolve({
      Items: pageItems,
      ...(hasMore && {
        LastEvaluatedKey: marshall({ pk: 'cursor', GSI1PK: 'cursor', GSI1SK: 'cursor' })
      })
    });
  });
}

describe('Property 1: Attribution lookup returns highest-numbered published issue', () => {
  let mockSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
    jest.restoreAllMocks();
  });

  /**
   * **Validates: Requirements 1.4, 2.3, 5.1, 5.2**
   */
  test('returns the highest-numbered published issue, or null if none exist', async () => {
    const tenantId = 'tenant-prop';

    await fc.assert(
      fc.asyncProperty(arbIssueRecords(tenantId), async (records) => {
        mockSend.mockReset();
        mockDdbForRecords(records, mockSend);

        const result = await getMostRecentPublishedIssue(tenantId);

        // Compute expected: highest issue number among published records
        const published = records.filter(r => r.publishedAt !== undefined);

        if (published.length === 0) {
          expect(result).toBeNull();
        } else {
          const expectedIssue = published.reduce((max, r) =>
            r.issueNumber > max.issueNumber ? r : max
          );
          expect(result).not.toBeNull();
          expect(result.pk).toBe(expectedIssue.pk);
          expect(result.issueNumber).toBe(expectedIssue.issueNumber);
        }
      }),
      { numRuns: 150 }
    );
  });
});
