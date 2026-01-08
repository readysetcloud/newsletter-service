import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as fc from 'fast-check';

const mockDdbSend = jest.fn();
const mockGetTenant = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDdbSend })),
  QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
}));

jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  formatResponse: jest.fn((statusCode, body) => ({
    statusCode,
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  })),
  getTenant: mockGetTenant,
}));

const { handler } = await import('../functions/subscribers/get-subscriber-stats.mjs');

describe('get-subscriber-stats handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';

    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Default implementation to prevent errors
    mockGetTenant.mockResolvedValue({
      pk: 'default-tenant',
      sk: 'tenant',
      subscribers: 0,
    });

    mockDdbSend.mockResolvedValue({ Items: [] });

    mockGetTenant.mockReset();
    mockDdbSend.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Property 5: Stats endpoint returns accurate counts', () => {
    /**
     * Feature: welcome-newsletter, Property 5: Stats endpoint returns accurate counts
     * For any tenant with subscribers, the stats endpoint should return the correct
     * total subscriber count and the correct count of subscribers added since the
     * previous Sunday at 00:00:00 UTC
     * Validates: Requirements 3.1, 3.2
     */
    test('returns accurate total and weekly subscriber counts for any tenant', async () => {
      const arbitraryStatsData = fc.record({
        tenantId: fc.uuid(),
        totalSubscribers: fc.integer({ min: 0, max: 100000 }),
        newThisWeek: fc.integer({ min: 0, max: 1000 }),
      });

      await fc.assert(
        fc.asyncProperty(arbitraryStatsData, async (data) => {
          let getTenantCalled = false;
          let queryCalled = false;

          mockGetTenant.mockImplementation(() => {
            getTenantCalled = true;
            return Promise.resolve({
              pk: data.tenantId,
              sk: 'tenant',
              subscribers: data.totalSubscribers,
            });
          });

          mockDdbSend.mockImplementation((command) => {
            if (command.__type === 'Query') {
              queryCalled = true;
              const items = Array.from({ length: data.newThisWeek }, (_, i) => ({
                pk: data.tenantId,
                sk: `subscriber#${Date.now() + i}#test${i}@example.com`,
                GSI1PK: data.tenantId,
                GSI1SK: `subscriber#${Date.now() + i}`,
                email: `test${i}@example.com`,
              }));
              return Promise.resolve({ Items: items });
            }
            return Promise.resolve({ Items: [] });
          });

          const event = {
            pathParameters: {
              tenant: data.tenantId,
            },
          };

          const response = await handler(event);

          // Property: Response should be successful
          expect(response.statusCode).toBe(200);

          const body = JSON.parse(response.body);

          // Property: If DB was queried (cache miss), values should match exactly
          if (getTenantCalled && queryCalled) {
            // Property: Total subscribers should match the tenant's subscriber count
            expect(body.totalSubscribers).toBe(data.totalSubscribers);

            // Property: New this week should match the count of subscriber events since Sunday
            expect(body.newThisWeek).toBe(data.newThisWeek);
          }

          // Property: Week start date should always be present and valid
          expect(body.weekStartDate).toBeDefined();
          expect(typeof body.weekStartDate).toBe('string');

          // Property: Response should have required numeric fields
          expect(typeof body.totalSubscribers).toBe('number');
          expect(typeof body.newThisWeek).toBe('number');
        }),
        { numRuns: 5 }
      );
    });
  });

  describe('Property 6: Stats response format', () => {
    /**
     * Feature: welcome-newsletter, Property 6: Stats response format
     * For any stats endpoint response, the response should be valid JSON
     * containing totalSubscribers, newThisWeek, and weekStartDate fields
     * Validates: Requirements 3.3
     */
    test('response contains all required fields in correct format for any tenant', async () => {
      const arbitraryData = fc.record({
        tenantId: fc.uuid(),
        subscribers: fc.integer({ min: 0, max: 100000 }),
      });

      await fc.assert(
        fc.asyncProperty(arbitraryData, async (data) => {
          mockGetTenant.mockResolvedValue({
            pk: data.tenantId,
            sk: 'tenant',
            subscribers: data.subscribers,
          });

          mockDdbSend.mockImplementation((command) => {
            if (command.__type === 'Query') {
              return Promise.resolve({ Items: [] });
            }
            return Promise.resolve({ Items: [] });
          });

          const event = {
            pathParameters: {
              tenant: data.tenantId,
            },
          };

          const response = await handler(event);

          // Property: Response should be successful (whether cache hit or miss)
          expect(response.statusCode).toBe(200);

          // Property: Response should be valid JSON
          expect(() => JSON.parse(response.body)).not.toThrow();

          const body = JSON.parse(response.body);

          // Property: Response must contain totalSubscribers field as a number
          expect(body).toHaveProperty('totalSubscribers');
          expect(typeof body.totalSubscribers).toBe('number');

          // Property: Response must contain newThisWeek field as a number
          expect(body).toHaveProperty('newThisWeek');
          expect(typeof body.newThisWeek).toBe('number');

          // Property: Response must contain weekStartDate field as an ISO 8601 string
          expect(body).toHaveProperty('weekStartDate');
          expect(typeof body.weekStartDate).toBe('string');
          expect(() => new Date(body.weekStartDate)).not.toThrow();

          // Property: weekStartDate should be a valid ISO 8601 date
          const weekStart = new Date(body.weekStartDate);
          expect(weekStart.toISOString()).toBe(body.weekStartDate);
        }),
        { numRuns: 5 }
      );
    });
  });

  describe('Property 7: Stats caching consistency', () => {
    /**
     * Feature: welcome-newsletter, Property 7: Stats caching consistency
     * For any stats endpoint request, making multiple requests within a 1-hour
     * window should return the same cached result without querying the database
     * Validates: Requirements 3.5
     */
    test('multiple requests within cache window return same result without additional DB queries', async () => {
      const arbitraryData = fc.record({
        tenantId: fc.uuid(),
        totalSubscribers: fc.integer({ min: 0, max: 10000 }),
        newThisWeek: fc.integer({ min: 0, max: 100 }),
      });

      await fc.assert(
        fc.asyncProperty(arbitraryData, async (data) => {
          mockDdbSend.mockClear();
          mockGetTenant.mockClear();

          let callCount = 0;

          mockGetTenant.mockImplementation(() => {
            callCount++;
            return Promise.resolve({
              pk: data.tenantId,
              sk: 'tenant',
              subscribers: data.totalSubscribers,
            });
          });

          mockDdbSend.mockImplementation((command) => {
            callCount++;
            if (command.__type === 'Query') {
              const items = Array.from({ length: data.newThisWeek }, (_, i) => ({
                pk: data.tenantId,
                sk: `subscriber#${Date.now() + i}#test${i}@example.com`,
              }));
              return Promise.resolve({ Items: items });
            }
            return Promise.resolve({ Items: [] });
          });

          const event = {
            pathParameters: {
              tenant: data.tenantId,
            },
          };

          // First request
          const response1 = await handler(event);
          const body1 = JSON.parse(response1.body);
          const dbCallsAfterFirst = callCount;

          // Second request (should use cache)
          const response2 = await handler(event);
          const body2 = JSON.parse(response2.body);
          const dbCallsAfterSecond = callCount;

          // Property: Second request should not make additional DB calls
          expect(dbCallsAfterSecond).toBe(dbCallsAfterFirst);

          // Property: Both responses should be identical
          expect(body2.totalSubscribers).toBe(body1.totalSubscribers);
          expect(body2.newThisWeek).toBe(body1.newThisWeek);
          expect(body2.weekStartDate).toBe(body1.weekStartDate);

          // Property: Cache-Control header should be present
          expect(response1.headers['Cache-Control']).toBe('public, max-age=3600');
          expect(response2.headers['Cache-Control']).toBe('public, max-age=3600');
        }),
        { numRuns: 5 }
      );
    });
  });

  describe('Unit tests for specific scenarios', () => {
    test('returns 400 when tenant ID is missing', async () => {
      const event = {
        pathParameters: {},
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Tenant ID is required');
    });

    test('returns 404 when tenant does not exist', async () => {
      mockGetTenant.mockResolvedValue(null);

      const event = {
        pathParameters: {
          tenant: 'non-existent-tenant-' + Date.now(),
        },
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Tenant not found');
    });

    test('handles tenant with zero subscribers', async () => {
      mockGetTenant.mockResolvedValue({
        pk: 'zero-tenant-' + Date.now(),
        sk: 'tenant',
        subscribers: 0,
      });

      mockDdbSend.mockImplementation((command) => {
        if (command.__type === 'Query') {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({});
      });

      const event = {
        pathParameters: {
          tenant: 'zero-tenant-' + Date.now(),
        },
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.totalSubscribers).toBe(0);
      expect(body.newThisWeek).toBe(0);
    });

    test('handles DynamoDB errors gracefully', async () => {
      mockGetTenant.mockResolvedValue({
        pk: 'error-test-tenant-' + Date.now(),
        sk: 'tenant',
        subscribers: 100,
      });

      mockDdbSend.mockRejectedValue(new Error('DynamoDB error'));

      const event = {
        pathParameters: {
          tenant: 'error-test-tenant-' + Date.now(),
        },
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Failed to retrieve subscriber stats');
      expect(console.error).toHaveBeenCalled();
    });

    test('calculates previous Sunday correctly', async () => {
      mockGetTenant.mockResolvedValue({
        pk: 'sunday-test-' + Date.now(),
        sk: 'tenant',
        subscribers: 100,
      });

      mockDdbSend.mockImplementation((command) => {
        if (command.__type === 'Query') {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({});
      });

      const event = {
        pathParameters: {
          tenant: 'sunday-test-' + Date.now(),
        },
      };

      const response = await handler(event);
      const body = JSON.parse(response.body);

      const weekStart = new Date(body.weekStartDate);

      // Property: Week start should be a Sunday
      expect(weekStart.getUTCDay()).toBe(0);

      // Property: Week start should be at midnight UTC
      expect(weekStart.getUTCHours()).toBe(0);
      expect(weekStart.getUTCMinutes()).toBe(0);
      expect(weekStart.getUTCSeconds()).toBe(0);
      expect(weekStart.getUTCMilliseconds()).toBe(0);

      // Property: Week start should be in the past
      expect(weekStart.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});

