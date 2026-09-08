import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let ddbSend;
let UpdateItemCommand;
let QueryCommand;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') {
            result[key] = { S: value };
          } else if (typeof value === 'number') {
            result[key] = { N: String(value) };
          } else if (Array.isArray(value)) {
            result[key] = { L: value.map(v => ({ S: v })) };
          } else if (typeof value === 'object' && value !== null) {
            result[key] = { M: {} };
          }
        }
        return result;
      }),
      unmarshall: jest.fn((obj) => {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          if (value.S !== undefined) {
            result[key] = value.S;
          } else if (value.N !== undefined) {
            result[key] = Number(value.N);
          } else if (value.M !== undefined) {
            result[key] = {};
          }
        }
        return result;
      }),
    }));

    ({ handler } = await import('../functions/build-report-data.mjs'));
    ({ UpdateItemCommand, QueryCommand } = await import('@aws-sdk/client-dynamodb'));
  });
};

describe('build-report-data', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  describe('Analytics consolidation', () => {
    it('should update stats record with analytics data', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });

      const state = {
        issue: 'tenant123#42',
        subscribers: 1000,
        priorSubscribers: 975,
        sentDate: '2025-01-21T10:00:00.000Z',
        subjectLine: 'Test Newsletter',
        links: [
          { link: 'https://example.com/article1', count: 20 },
          { link: 'https://example.com/article2', count: 10 }
        ],
        stats: {
          M: {
            deliveries: { N: '500' },
            opens: { N: '150' },
            reopens: { N: '20' },
            bounces: { N: '5' },
            unsubscribes: { N: '3' },
            sends: { N: '505' },
            cleaned: { N: '1' }
          }
        }
      };

      const result = await handler(state);

      expect(result.subject).toContain('Performance Report');
      expect(result.insightData).toBeDefined();
      expect(result.insightData.currentMetrics).toBeDefined();

      const updateCalls = ddbSend.mock.calls.filter(call => call[0].__type === 'UpdateItem');
      expect(updateCalls.length).toBeGreaterThan(0);

      const analyticsUpdate = updateCalls.find(call =>
        call[0].UpdateExpression && call[0].UpdateExpression.includes('analytics')
      );
      expect(analyticsUpdate).toBeDefined();
      expect(analyticsUpdate[0].UpdateExpression).toContain('SET analytics = :analytics');
      expect(analyticsUpdate[0].UpdateExpression).toContain('statsPhase = :phase');
      expect(analyticsUpdate[0].UpdateExpression).toContain('consolidatedAt = :timestamp');
      expect(analyticsUpdate[0].ExpressionAttributeValues[':phase'].S).toBe('consolidated');
    });

    it('should set statsPhase to consolidated', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });

      const state = {
        issue: 'tenant456#7',
        subscribers: 500,
        priorSubscribers: 490,
        sentDate: '2025-01-21T12:00:00.000Z',
        subjectLine: 'Another Newsletter',
        links: [],
        stats: {
          M: {
            deliveries: { N: '250' },
            opens: { N: '75' },
            reopens: { N: '10' },
            bounces: { N: '2' },
            unsubscribes: { N: '1' },
            sends: { N: '252' },
            cleaned: { N: '0' }
          }
        }
      };

      await handler(state);

      const updateCalls = ddbSend.mock.calls.filter(call => call[0].__type === 'UpdateItem');
      const analyticsUpdate = updateCalls.find(call =>
        call[0].UpdateExpression && call[0].UpdateExpression.includes('statsPhase')
      );

      expect(analyticsUpdate).toBeDefined();
      expect(analyticsUpdate[0].ExpressionAttributeValues[':phase'].S).toBe('consolidated');
      expect(analyticsUpdate[0].ExpressionAttributeValues[':timestamp']).toBeDefined();
    });

    it('should include all analytics data in the update', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });

      const state = {
        issue: 'tenant789#100',
        subscribers: 2000,
        priorSubscribers: 1950,
        sentDate: '2025-01-21T14:00:00.000Z',
        subjectLine: 'Big Newsletter',
        links: [
          { link: 'https://example.com/top', count: 50 }
        ],
        stats: {
          M: {
            deliveries: { N: '1000' },
            opens: { N: '300' },
            reopens: { N: '40' },
            bounces: { N: '10' },
            unsubscribes: { N: '5' },
            sends: { N: '1010' },
            cleaned: { N: '2' }
          }
        }
      };

      const result = await handler(state);

      expect(result.insightData.currentMetrics).toBeDefined();
      expect(result.insightData.currentMetrics.openRate).toBeDefined();
      expect(result.insightData.currentMetrics.clickThroughRate).toBeDefined();
      expect(result.insightData.benchmarks).toBeDefined();
      expect(result.insightData.healthScore).toBeDefined();
      expect(result.insightData.contentPerformance).toBeDefined();
      expect(result.insightData.listHealth).toBeDefined();
      expect(result.insightData.engagementQuality).toBeDefined();
      expect(result.insightData.trends).toBeDefined();
    });

    it('should attach insight candidates from event analytics', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });

      const eventAnalytics = {
        deviceBreakdown: { mobile: 70, desktop: 10 },
        trafficSource: { clicks: { email: 80, web: 20 } },
        clickDecay: [
          { hour: 0, clicks: 5, cumulativeClicks: 5 },
          { hour: 2, clicks: 5, cumulativeClicks: 10 }
        ],
        complaintDetails: [{ email: 'hash', timestamp: '2025-01-21T10:00:00Z', complaintType: 'spam' }]
      };

      const state = {
        issue: 'tenant999#200',
        subscribers: 1000,
        priorSubscribers: 990,
        sentDate: '2025-01-21T16:00:00.000Z',
        subjectLine: 'Insights Newsletter',
        links: [
          { link: 'https://example.com/top', count: 50 }
        ],
        stats: {
          M: {
            deliveries: { N: '800' },
            opens: { N: '200' },
            reopens: { N: '20' },
            bounces: { N: '5' },
            unsubscribes: { N: '3' },
            sends: { N: '805' },
            cleaned: { N: '1' },
            analytics: { S: JSON.stringify(eventAnalytics) }
          }
        }
      };

      const result = await handler(state);

      expect(result.insightData.eventAnalytics).toBeDefined();
      expect(result.insightData.insightCandidates).toBeDefined();
      expect(Array.isArray(result.insightData.insightCandidates)).toBe(true);
      expect(result.insightData.insightCandidates.length).toBeGreaterThan(0);
    });
  });

  /**
   * The weekly report ran for months with every engagement figure at zero.
   * The consolidating write attached a `:clickGeography` value while the
   * update expression never mentioned it, DynamoDB rejected the whole call,
   * and the single catch around the block threw away the analytics that had
   * already been computed correctly and substituted zeros. Nothing failed
   * loudly; the report just stopped meaning anything.
   */
  describe('Consolidated stats write', () => {
    // Five queries the handler makes around consolidation, in order. Records
    // are supplied so the computed analytics are non-zero and therefore
    // distinguishable from the fallback.
    const primeQueries = ({ opens = [], clicks = [] } = {}) => {
      ddbSend.mockResolvedValueOnce({ Items: opens });
      ddbSend.mockResolvedValueOnce({ Items: clicks });
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });
    };

    const state = {
      issue: 'tenant123#231',
      subscribers: 1000,
      priorSubscribers: 975,
      sentDate: '2025-01-21T10:00:00.000Z',
      subjectLine: 'Test Newsletter',
      links: [],
      stats: {
        M: {
          deliveries: { N: '500' },
          opens: { N: '150' },
          reopens: { N: '20' },
          bounces: { N: '5' },
          unsubscribes: { N: '3' },
          sends: { N: '505' },
          cleaned: { N: '1' }
        }
      }
    };

    const consolidationUpdate = () =>
      ddbSend.mock.calls
        .map(call => call[0])
        .find(cmd => cmd.__type === 'UpdateItem'
          && cmd.UpdateExpression
          && cmd.UpdateExpression.includes('uniqueOpens'));

    it('references every value it supplies', async () => {
      primeQueries();

      await handler(state);

      const update = consolidationUpdate();
      expect(update).toBeDefined();

      // The invariant DynamoDB actually enforces, checked directly rather than
      // by asserting on one attribute name: a supplied value that the
      // expression does not mention fails the whole request.
      for (const placeholder of Object.keys(update.ExpressionAttributeValues)) {
        expect(update.UpdateExpression).toContain(placeholder);
      }
    });

    it('assigns click geography rather than only supplying it', async () => {
      primeQueries();

      await handler(state);

      const update = consolidationUpdate();
      // Click geography is always computed - the aggregator returns an object
      // even for no clicks - so this clause is always required.
      expect(update.UpdateExpression).toContain('clickGeography = :clickGeography');
      expect(update.ExpressionAttributeValues[':clickGeography']).toBeDefined();
    });

    it('starts the expression with a single SET', async () => {
      primeQueries();

      await handler(state);

      expect(consolidationUpdate().UpdateExpression).toMatch(/^SET [^S]/);
    });

    it('still reports the analytics it computed when the write is rejected', async () => {
      // Flat attribute values: the unmarshall stub in this file collapses a
      // nested map to an empty object, which would strip the timestamp the
      // consolidation filters on.
      ddbSend.mockResolvedValueOnce({
        Items: [
          { createdAt: { S: '2025-01-21T10:30:00.000Z' }, userAgent: { S: 'Mozilla/5.0' } }
        ]
      });
      ddbSend.mockResolvedValueOnce({ Items: [] });
      // The consolidating write fails the way a malformed expression does.
      ddbSend.mockRejectedValueOnce(Object.assign(new Error('unused in expressions'), {
        name: 'ValidationException'
      }));
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });

      const result = await handler(state);

      // Caching the result is not what the report is for. A rejected write
      // must not zero out figures that were computed before it. The device
      // breakdown is the clearest tell: computed from the one open record it
      // is populated, while the fallback leaves it empty.
      expect(result.insightData.engagement.deviceBreakdown).not.toEqual({});
      expect(result.insightData.clickGeography).toBeDefined();
    });

    it('does not fail the report when the write is rejected', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockRejectedValueOnce(Object.assign(new Error('unused in expressions'), {
        name: 'ValidationException'
      }));
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });

      await expect(handler(state)).resolves.toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should throw error if required state data is missing', async () => {
      const state = {
        issue: 'tenant123#42'
      };

      await expect(handler(state)).rejects.toThrow('Missing required state data');
    });

    it('should handle consolidation errors gracefully', async () => {
      ddbSend.mockRejectedValueOnce(new Error('Query failed'));
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({ Items: [] });
      ddbSend.mockResolvedValueOnce({ Items: [] });

      const state = {
        issue: 'tenant123#42',
        subscribers: 1000,
        priorSubscribers: 975,
        sentDate: '2025-01-21T10:00:00.000Z',
        subjectLine: 'Test Newsletter',
        links: [],
        stats: {
          M: {
            deliveries: { N: '500' },
            opens: { N: '150' },
            reopens: { N: '20' },
            bounces: { N: '5' },
            unsubscribes: { N: '3' },
            sends: { N: '505' },
            cleaned: { N: '1' }
          }
        }
      };

      const result = await handler(state);

      expect(result).toBeDefined();
      expect(result.insightData).toBeDefined();
    });
  });
});
