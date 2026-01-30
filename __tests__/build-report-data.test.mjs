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
