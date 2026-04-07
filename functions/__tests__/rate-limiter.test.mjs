import { jest } from '@jest/globals';
import * as fc from 'fast-check';

// Shared counter map to simulate DynamoDB atomic increments
// Reset between property iterations via the test logic
const counters = new Map();

const mockSend = jest.fn().mockImplementation((command) => {
  const pk = command.input.Key.pk.S;
  const currentCount = (counters.get(pk) || 0) + 1;
  counters.set(pk, currentCount);

  const ttlValue = command.input.ExpressionAttributeValues[':ttl'].N;
  return Promise.resolve({
    Attributes: {
      count: { N: String(currentCount) },
      ttl: { N: ttlValue }
    }
  });
});

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  UpdateItemCommand: jest.fn((input) => ({ input }))
}));

// Set required env vars before import
process.env.TABLE_NAME = 'TestTable';
process.env.UNKNOWN_IP_RATE_LIMIT_THRESHOLD = '5';

const { checkRateLimit } = await import('../utils/rate-limiter.mjs');

// Feature: bot-signup-protection, Property 6: Rate limiter enforces threshold
describe('Property 6: Rate limiter enforces threshold', () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   */
  test('returns limited:false for first N requests and limited:true after threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),   // threshold
        fc.integer({ min: 1, max: 20 }),    // extra requests beyond threshold
        fc.stringMatching(/^[a-z]{3,10}$/), // tenantId
        fc.stringMatching(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/), // sourceIp
        fc.integer({ min: 60, max: 86400 }), // windowSeconds
        async (threshold, extraRequests, tenantId, sourceIp, windowSeconds) => {
          // Reset counters for each property iteration
          counters.clear();

          const totalRequests = threshold + extraRequests;
          const policy = {
            rateLimitThreshold: threshold,
            rateLimitWindowSeconds: windowSeconds
          };

          for (let i = 1; i <= totalRequests; i++) {
            const result = await checkRateLimit(tenantId, sourceIp, policy);

            expect(result.count).toBe(i);

            if (i <= threshold) {
              expect(result.limited).toBe(false);
              expect(result.retryAfterSeconds).toBeNull();
            } else {
              expect(result.limited).toBe(true);
              expect(typeof result.retryAfterSeconds).toBe('number');
              expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: bot-signup-protection, Property 7: Rate limiter isolates tenants
describe('Property 7: Rate limiter isolates tenants', () => {
  /**
   * **Validates: Requirements 5.4**
   */
  test('two distinct tenants sharing the same IP have independent counters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z]{3,10}$/),  // tenantA
        fc.stringMatching(/^[a-z]{3,10}$/),  // tenantB
        fc.stringMatching(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/), // shared IP
        fc.integer({ min: 1, max: 10 }),      // requestsA
        fc.integer({ min: 1, max: 10 }),      // requestsB
        async (tenantA, tenantB, sharedIp, requestsA, requestsB) => {
          // Ensure tenants are actually distinct
          fc.pre(tenantA !== tenantB);

          // Reset counters for each property iteration
          counters.clear();

          const policy = {
            rateLimitThreshold: 1000, // high threshold so we don't hit limits
            rateLimitWindowSeconds: 3600
          };

          // Send requestsA requests for tenantA
          for (let i = 1; i <= requestsA; i++) {
            const result = await checkRateLimit(tenantA, sharedIp, policy);
            expect(result.count).toBe(i);
          }

          // Send requestsB requests for tenantB — counters must start from 1
          for (let i = 1; i <= requestsB; i++) {
            const result = await checkRateLimit(tenantB, sharedIp, policy);
            expect(result.count).toBe(i);
          }

          // Verify the counters are stored under different keys
          const keyA = `ratelimit#${tenantA}#${sharedIp}`;
          const keyB = `ratelimit#${tenantB}#${sharedIp}`;
          expect(counters.get(keyA)).toBe(requestsA);
          expect(counters.get(keyB)).toBe(requestsB);
        }
      ),
      { numRuns: 100 }
    );
  });
});
