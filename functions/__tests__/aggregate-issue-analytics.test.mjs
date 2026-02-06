import { jest } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient, QueryCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb');
const {
  handler,
  queryEventsByType,
  queryAllEventsParallel,
  calculateLinkPerformance,
  calculateClickDecay,
  calculateGeoDistribution,
  calculateDeviceBreakdown,
  calculateTimingMetrics,
  calculateEngagementType,
  calculateTrafficSource,
  calculateBounceReasons,
  formatComplaintDetails
} = await import('../aggregate-issue-analytics.mjs');

describe('aggregate-issue-analytics', () => {
  let mockSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  describe('handler', () => {
    test('should successfully aggregate analytics and update stats record', async () => {
      const event = {
        tenantId: 'tenant123',
        issueNumber: '42',
        publishedAt: '2025-01-29T10:00:00.000Z'
      };

      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.success).toBe(true);
      expect(result.issueNumber).toBe('42');
      expect(mockSend).toHaveBeenCalledTimes(6);

      const firstCall = mockSend.mock.calls[0][0];
      expect(firstCall).toBeInstanceOf(UpdateItemCommand);
      expect(firstCall.input.ConditionExpression).toContain('statsPhase');

      const lastCall = mockSend.mock.calls[5][0];
      expect(lastCall).toBeInstanceOf(UpdateItemCommand);
      const updateValues = unmarshall(lastCall.input.ExpressionAttributeValues);
      expect(updateValues[':phase']).toBe('consolidated');
      expect(updateValues[':version']).toBe('1.0');
      expect(updateValues[':analytics']).toBeDefined();
    });

    test('should exit early if aggregation already in progress', async () => {
      const event = {
        tenantId: 'tenant123',
        issueNumber: '42',
        publishedAt: '2025-01-29T10:00:00.000Z'
      };

      const conditionalError = new Error('ConditionalCheckFailedException');
      conditionalError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionalError);

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.message).toContain('already in progress or completed');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('should reset statsPhase on aggregation error', async () => {
      const event = {
        tenantId: 'tenant123',
        issueNumber: '42',
        publishedAt: '2025-01-29T10:00:00.000Z'
      };

      mockSend
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DynamoDB query failed'))
        .mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.statusCode).toBe(500);

      const resetCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
      expect(resetCall).toBeInstanceOf(UpdateItemCommand);
      expect(resetCall.input.UpdateExpression).toBe('REMOVE statsPhase');
    });

    test('should return error for missing required parameters', async () => {
      const event = {
        tenantId: 'tenant123',
        issueNumber: '42'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(result.body).toContain('Missing required parameters');
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('should build complete insights object with all analytics', async () => {
      const event = {
        tenantId: 'tenant123',
        issueNumber: '42',
        publishedAt: '2025-01-29T10:00:00.000Z'
      };

      const sampleClicks = [
        marshall({
          linkUrl: 'https://example.com/article1',
          linkPosition: 1,
          timestamp: '2025-01-29T10:30:00.000Z',
          subscriberEmailHash: 'hash1',
          device: 'mobile',
          country: 'US',
          trafficSource: 'email',
          timeToClick: 1800
        })
      ];

      const sampleOpens = [
        marshall({
          timestamp: '2025-01-29T10:15:00.000Z',
          subscriberEmailHash: 'hash1',
          device: 'desktop',
          country: 'US',
          timeToOpen: 900
        })
      ];

      const sampleBounces = [
        marshall({
          bounceType: 'permanent',
          timestamp: '2025-01-29T10:05:00.000Z'
        })
      ];

      const sampleComplaints = [
        marshall({
          subscriberEmailHash: 'hash2',
          timestamp: '2025-01-29T11:00:00.000Z',
          complaintType: 'spam'
        })
      ];

      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Items: sampleClicks })
        .mockResolvedValueOnce({ Items: sampleOpens })
        .mockResolvedValueOnce({ Items: sampleBounces })
        .mockResolvedValueOnce({ Items: sampleComplaints })
        .mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.success).toBe(true);

      const finalUpdateCall = mockSend.mock.calls[5][0];
      const updateValues = unmarshall(finalUpdateCall.input.ExpressionAttributeValues);
      const analytics = updateValues[':analytics'];

      expect(analytics).toHaveProperty('links');
      expect(analytics).toHaveProperty('clickDecay');
      expect(analytics).toHaveProperty('openDecay');
      expect(analytics).toHaveProperty('geoDistribution');
      expect(analytics).toHaveProperty('deviceBreakdown');
      expect(analytics).toHaveProperty('timingMetrics');
      expect(analytics).toHaveProperty('engagementType');
      expect(analytics).toHaveProperty('trafficSource');
      expect(analytics).toHaveProperty('bounceReasons');
      expect(analytics).toHaveProperty('complaintDetails');
    });
  });

  describe('queryEventsByType', () => {
    test('should query events with correct KeyConditionExpression', async () => {
      mockSend.mockResolvedValue({
        Items: [
          marshall({
            pk: 'tenant123#42',
            sk: 'click#2025-01-29T10:00:00.000Z#hash1#link1#ulid1',
            eventType: 'click',
            timestamp: '2025-01-29T10:00:00.000Z',
            linkUrl: 'https://example.com/article1'
          })
        ]
      });

      const ddb = new DynamoDBClient();
      const events = await queryEventsByType(ddb, 'tenant123', '42', 'click');

      expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
      const queryCommand = mockSend.mock.calls[0][0];
      expect(queryCommand.input.TableName).toBe('test-table');
      expect(queryCommand.input.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :eventType)');

      const values = unmarshall(queryCommand.input.ExpressionAttributeValues);
      expect(values[':pk']).toBe('tenant123#42');
      expect(values[':eventType']).toBe('click#');

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('click');
      expect(events[0].linkUrl).toBe('https://example.com/article1');
    });

    test('should handle pagination with LastEvaluatedKey', async () => {
      const page1Items = [
        marshall({
          pk: 'tenant123#42',
          sk: 'click#2025-01-29T10:00:00.000Z#hash1#link1#ulid1',
          eventType: 'click',
          timestamp: '2025-01-29T10:00:00.000Z'
        })
      ];

      const page2Items = [
        marshall({
          pk: 'tenant123#42',
          sk: 'click#2025-01-29T10:01:00.000Z#hash2#link2#ulid2',
          eventType: 'click',
          timestamp: '2025-01-29T10:01:00.000Z'
        })
      ];

      mockSend
        .mockResolvedValueOnce({
          Items: page1Items,
          LastEvaluatedKey: marshall({ pk: 'tenant123#42', sk: 'click#2025-01-29T10:00:00.000Z#hash1#link1#ulid1' })
        })
        .mockResolvedValueOnce({
          Items: page2Items
        });

      const ddb = new DynamoDBClient();
      const events = await queryEventsByType(ddb, 'tenant123', '42', 'click');

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(events).toHaveLength(2);

      const secondCall = mockSend.mock.calls[1][0];
      expect(secondCall.input.ExclusiveStartKey).toBeDefined();
    });

    test('should return empty array when no events found', async () => {
      mockSend.mockResolvedValue({
        Items: []
      });

      const ddb = new DynamoDBClient();
      const events = await queryEventsByType(ddb, 'tenant123', '42', 'click');

      expect(events).toEqual([]);
    });
  });

  describe('queryAllEventsParallel', () => {
    test('should query all four event types in parallel', async () => {
      mockSend.mockImplementation((command) => {
        const values = unmarshall(command.input.ExpressionAttributeValues);
        const eventType = values[':eventType'].replace('#', '');

        return Promise.resolve({
          Items: [
            marshall({
              pk: 'tenant123#42',
              sk: `${eventType}#2025-01-29T10:00:00.000Z#hash#id#ulid`,
              eventType,
              timestamp: '2025-01-29T10:00:00.000Z'
            })
          ]
        });
      });

      const ddb = new DynamoDBClient();
      const events = await queryAllEventsParallel(ddb, 'tenant123', '42');

      expect(mockSend).toHaveBeenCalledTimes(4);
      expect(events).toHaveProperty('clicks');
      expect(events).toHaveProperty('opens');
      expect(events).toHaveProperty('bounces');
      expect(events).toHaveProperty('complaints');

      expect(events.clicks).toHaveLength(1);
      expect(events.opens).toHaveLength(1);
      expect(events.bounces).toHaveLength(1);
      expect(events.complaints).toHaveLength(1);
    });
  });

  describe('calculateLinkPerformance', () => {
    test('should group clicks by linkUrl and count correctly', () => {
      const clicks = [
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US' },
        { linkUrl: 'https://example.com/article2', linkPosition: 2, country: 'GB' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'CA' }
      ];

      const result = calculateLinkPerformance(clicks);

      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('https://example.com/article1');
      expect(result[0].clicks).toBe(3);
      expect(result[1].url).toBe('https://example.com/article2');
      expect(result[1].clicks).toBe(1);
    });

    test('should calculate percentOfTotal correctly', () => {
      const clicks = [
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US' },
        { linkUrl: 'https://example.com/article2', linkPosition: 2, country: 'GB' },
        { linkUrl: 'https://example.com/article3', linkPosition: 3, country: 'CA' }
      ];

      const result = calculateLinkPerformance(clicks);

      expect(result[0].percentOfTotal).toBe(50);
      expect(result[1].percentOfTotal).toBe(25);
      expect(result[2].percentOfTotal).toBe(25);
    });

    test('should limit to top 20 links', () => {
      const clicks = [];
      for (let i = 1; i <= 25; i++) {
        for (let j = 0; j < i; j++) {
          clicks.push({
            linkUrl: `https://example.com/article${i}`,
            linkPosition: i,
            country: 'US'
          });
        }
      }

      const result = calculateLinkPerformance(clicks);

      expect(result).toHaveLength(20);
      expect(result[0].clicks).toBe(25);
      expect(result[19].clicks).toBe(6);
    });

    test('should include geoDistribution for each link', () => {
      const clicks = [
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash1' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash1' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'GB', subscriberEmailHash: 'hash2' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'CA', subscriberEmailHash: 'hash3' },
        { linkUrl: 'https://example.com/article2', linkPosition: 2, country: 'US', subscriberEmailHash: 'hash4' },
        { linkUrl: 'https://example.com/article2', linkPosition: 2, country: 'GB', subscriberEmailHash: 'hash5' }
      ];

      const result = calculateLinkPerformance(clicks);

      expect(result[0].geoDistribution).toBeDefined();
      expect(result[0].geoDistribution).toHaveLength(3);
      expect(result[0].geoDistribution[0]).toEqual({ country: 'US', clicks: 2, uniqueUsers: 1 });
      expect(result[0].geoDistribution[1]).toEqual({ country: 'GB', clicks: 1, uniqueUsers: 1 });
      expect(result[0].geoDistribution[2]).toEqual({ country: 'CA', clicks: 1, uniqueUsers: 1 });

      expect(result[1].geoDistribution).toHaveLength(2);
      expect(result[1].geoDistribution[0]).toEqual({ country: 'US', clicks: 1, uniqueUsers: 1 });
      expect(result[1].geoDistribution[1]).toEqual({ country: 'GB', clicks: 1, uniqueUsers: 1 });
    });

    test('should handle missing country in clicks', () => {
      const clicks = [
        { linkUrl: 'https://example.com/article1', linkPosition: 1, subscriberEmailHash: 'hash1' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash2' }
      ];

      const result = calculateLinkPerformance(clicks);

      expect(result[0].geoDistribution).toBeDefined();
      expect(result[0].geoDistribution).toHaveLength(2);
      expect(result[0].geoDistribution.find(g => g.country === 'unknown')).toEqual({ country: 'unknown', clicks: 1, uniqueUsers: 1 });
      expect(result[0].geoDistribution.find(g => g.country === 'US')).toEqual({ country: 'US', clicks: 1, uniqueUsers: 1 });
    });

    test('should sort geoDistribution by clicks descending', () => {
      const clicks = [
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'CA', subscriberEmailHash: 'hash1' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash2' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash3' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash4' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'GB', subscriberEmailHash: 'hash5' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'GB', subscriberEmailHash: 'hash6' }
      ];

      const result = calculateLinkPerformance(clicks);

      expect(result[0].geoDistribution[0].country).toBe('US');
      expect(result[0].geoDistribution[0].clicks).toBe(3);
      expect(result[0].geoDistribution[0].uniqueUsers).toBe(3);
      expect(result[0].geoDistribution[1].country).toBe('GB');
      expect(result[0].geoDistribution[1].clicks).toBe(2);
      expect(result[0].geoDistribution[1].uniqueUsers).toBe(2);
      expect(result[0].geoDistribution[2].country).toBe('CA');
      expect(result[0].geoDistribution[2].clicks).toBe(1);
      expect(result[0].geoDistribution[2].uniqueUsers).toBe(1);
    });

    test('should deduplicate users per country', () => {
      const clicks = [
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash1' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash1' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash1' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash2' }
      ];

      const result = calculateLinkPerformance(clicks);

      expect(result[0].geoDistribution[0]).toEqual({
        country: 'US',
        clicks: 4,
        uniqueUsers: 2
      });
    });

    test('should exclude unknown subscriber hashes from unique user count', () => {
      const clicks = [
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'unknown' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash1' },
        { linkUrl: 'https://example.com/article1', linkPosition: 1, country: 'US', subscriberEmailHash: 'hash2' }
      ];

      const result = calculateLinkPerformance(clicks);

      expect(result[0].geoDistribution[0]).toEqual({
        country: 'US',
        clicks: 3,
        uniqueUsers: 2
      });
    });
  });

  describe('calculateClickDecay', () => {
    test('should group clicks by hour since publication', () => {
      const publishedAt = '2025-01-29T10:00:00.000Z';
      const clicks = [
        { timestamp: '2025-01-29T10:30:00.000Z' },
        { timestamp: '2025-01-29T10:45:00.000Z' },
        { timestamp: '2025-01-29T11:15:00.000Z' },
        { timestamp: '2025-01-29T12:30:00.000Z' },
        { timestamp: '2025-01-29T12:45:00.000Z' }
      ];

      const result = calculateClickDecay(clicks, publishedAt);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ hour: 0, clicks: 2, cumulativeClicks: 2 });
      expect(result[1]).toEqual({ hour: 1, clicks: 1, cumulativeClicks: 3 });
      expect(result[2]).toEqual({ hour: 2, clicks: 2, cumulativeClicks: 5 });
    });

    test('should limit to first 168 hours', () => {
      const publishedAt = '2025-01-29T10:00:00.000Z';
      const clicks = [
        { timestamp: '2025-01-29T10:30:00.000Z' },
        { timestamp: '2025-02-05T09:30:00.000Z' },
        { timestamp: '2025-02-05T10:30:00.000Z' },
        { timestamp: '2025-02-06T10:30:00.000Z' }
      ];

      const result = calculateClickDecay(clicks, publishedAt);

      const maxHour = Math.max(...result.map(r => r.hour));
      expect(maxHour).toBeLessThanOrEqual(167);

      const totalClicks = result.reduce((sum, r) => sum + r.clicks, 0);
      expect(totalClicks).toBe(2);
    });
  });

  describe('calculateGeoDistribution', () => {
    test('should group clicks and opens by country', () => {
      const clicks = [
        { country: 'US', subscriberEmailHash: 'hash1' },
        { country: 'US', subscriberEmailHash: 'hash1' },
        { country: 'UK', subscriberEmailHash: 'hash2' },
        { country: 'CA', subscriberEmailHash: 'hash3' }
      ];
      const opens = [
        { country: 'US', subscriberEmailHash: 'hash4' },
        { country: 'UK', subscriberEmailHash: 'hash5' },
        { country: 'UK', subscriberEmailHash: 'hash6' },
        { country: 'AU', subscriberEmailHash: 'hash7' }
      ];

      const result = calculateGeoDistribution(clicks, opens);

      const us = result.find(r => r.country === 'US');
      expect(us).toEqual({ country: 'US', clicks: 2, opens: 1, uniqueClickUsers: 1, uniqueOpenUsers: 1 });

      const uk = result.find(r => r.country === 'UK');
      expect(uk).toEqual({ country: 'UK', clicks: 1, opens: 2, uniqueClickUsers: 1, uniqueOpenUsers: 2 });
    });

    test('should sort by clicks descending', () => {
      const clicks = [
        { country: 'US', subscriberEmailHash: 'hash1' },
        { country: 'US', subscriberEmailHash: 'hash2' },
        { country: 'US', subscriberEmailHash: 'hash3' },
        { country: 'UK', subscriberEmailHash: 'hash4' },
        { country: 'UK', subscriberEmailHash: 'hash5' },
        { country: 'CA', subscriberEmailHash: 'hash6' }
      ];
      const opens = [];

      const result = calculateGeoDistribution(clicks, opens);

      expect(result[0].country).toBe('US');
      expect(result[0].clicks).toBe(3);
      expect(result[0].uniqueClickUsers).toBe(3);
      expect(result[1].country).toBe('UK');
      expect(result[1].clicks).toBe(2);
      expect(result[1].uniqueClickUsers).toBe(2);
    });

    test('should limit to top 20 countries', () => {
      const clicks = [];
      for (let i = 1; i <= 25; i++) {
        for (let j = 0; j < i; j++) {
          clicks.push({ country: `Country${i}`, subscriberEmailHash: `hash${i}_${j}` });
        }
      }
      const opens = [];

      const result = calculateGeoDistribution(clicks, opens);

      expect(result).toHaveLength(20);
      expect(result[0].clicks).toBe(25);
      expect(result[19].clicks).toBe(6);
    });

    test('should handle missing country with default unknown', () => {
      const clicks = [
        { country: 'US', subscriberEmailHash: 'hash1' },
        { country: null, subscriberEmailHash: 'hash2' },
        { subscriberEmailHash: 'hash3' }
      ];
      const opens = [
        { country: undefined, subscriberEmailHash: 'hash4' }
      ];

      const result = calculateGeoDistribution(clicks, opens);

      const unknown = result.find(r => r.country === 'unknown');
      expect(unknown).toEqual({ country: 'unknown', clicks: 2, opens: 1, uniqueClickUsers: 2, uniqueOpenUsers: 1 });
    });

    test('should aggregate all events with total count matching sum of country counts', () => {
      const clicks = [
        { country: 'US', subscriberEmailHash: 'hash1' },
        { country: 'US', subscriberEmailHash: 'hash2' },
        { country: 'UK', subscriberEmailHash: 'hash3' },
        { country: 'CA', subscriberEmailHash: 'hash4' },
        { country: 'unknown', subscriberEmailHash: 'hash5' }
      ];
      const opens = [
        { country: 'US', subscriberEmailHash: 'hash6' },
        { country: 'UK', subscriberEmailHash: 'hash7' },
        { country: 'UK', subscriberEmailHash: 'hash8' },
        { country: 'AU', subscriberEmailHash: 'hash9' },
        { country: 'unknown', subscriberEmailHash: 'hash10' },
        { country: 'unknown', subscriberEmailHash: 'hash11' }
      ];

      const result = calculateGeoDistribution(clicks, opens);

      const totalClicks = result.reduce((sum, r) => sum + r.clicks, 0);
      const totalOpens = result.reduce((sum, r) => sum + r.opens, 0);

      expect(totalClicks).toBe(clicks.length);
      expect(totalOpens).toBe(opens.length);
    });

    test('should handle mixed valid and unknown countries correctly', () => {
      const clicks = [
        { country: 'US', subscriberEmailHash: 'hash1' },
        { country: 'US', subscriberEmailHash: 'hash2' },
        { country: null, subscriberEmailHash: 'hash3' },
        { country: 'UK', subscriberEmailHash: 'hash4' },
        { subscriberEmailHash: 'hash5' }
      ];
      const opens = [
        { country: 'US', subscriberEmailHash: 'hash6' },
        { country: undefined, subscriberEmailHash: 'hash7' },
        { country: 'CA', subscriberEmailHash: 'hash8' }
      ];

      const result = calculateGeoDistribution(clicks, opens);

      const us = result.find(r => r.country === 'US');
      expect(us).toEqual({ country: 'US', clicks: 2, opens: 1, uniqueClickUsers: 2, uniqueOpenUsers: 1 });

      const uk = result.find(r => r.country === 'UK');
      expect(uk).toEqual({ country: 'UK', clicks: 1, opens: 0, uniqueClickUsers: 1, uniqueOpenUsers: 0 });

      const ca = result.find(r => r.country === 'CA');
      expect(ca).toEqual({ country: 'CA', clicks: 0, opens: 1, uniqueClickUsers: 0, uniqueOpenUsers: 1 });

      const unknown = result.find(r => r.country === 'unknown');
      expect(unknown).toEqual({ country: 'unknown', clicks: 2, opens: 1, uniqueClickUsers: 2, uniqueOpenUsers: 1 });

      const totalClicks = result.reduce((sum, r) => sum + r.clicks, 0);
      const totalOpens = result.reduce((sum, r) => sum + r.opens, 0);
      expect(totalClicks).toBe(5);
      expect(totalOpens).toBe(3);
    });

    test('should deduplicate users per country for clicks', () => {
      const clicks = [
        { country: 'US', subscriberEmailHash: 'hash1' },
        { country: 'US', subscriberEmailHash: 'hash1' },
        { country: 'US', subscriberEmailHash: 'hash1' },
        { country: 'US', subscriberEmailHash: 'hash2' },
        { country: 'US', subscriberEmailHash: 'hash2' }
      ];
      const opens = [];

      const result = calculateGeoDistribution(clicks, opens);

      const us = result.find(r => r.country === 'US');
      expect(us.clicks).toBe(5);
      expect(us.uniqueClickUsers).toBe(2);
    });

    test('should deduplicate users per country for opens', () => {
      const clicks = [];
      const opens = [
        { country: 'GB', subscriberEmailHash: 'hash1' },
        { country: 'GB', subscriberEmailHash: 'hash1' },
        { country: 'GB', subscriberEmailHash: 'hash2' },
        { country: 'GB', subscriberEmailHash: 'hash3' },
        { country: 'GB', subscriberEmailHash: 'hash3' }
      ];

      const result = calculateGeoDistribution(clicks, opens);

      const gb = result.find(r => r.country === 'GB');
      expect(gb.opens).toBe(5);
      expect(gb.uniqueOpenUsers).toBe(3);
    });

    test('should exclude unknown subscriber hashes from unique user counts', () => {
      const clicks = [
        { country: 'US', subscriberEmailHash: 'unknown' },
        { country: 'US', subscriberEmailHash: 'unknown' },
        { country: 'US', subscriberEmailHash: 'hash1' }
      ];
      const opens = [
        { country: 'US', subscriberEmailHash: 'unknown' },
        { country: 'US', subscriberEmailHash: 'hash2' }
      ];

      const result = calculateGeoDistribution(clicks, opens);

      const us = result.find(r => r.country === 'US');
      expect(us.clicks).toBe(3);
      expect(us.opens).toBe(2);
      expect(us.uniqueClickUsers).toBe(1);
      expect(us.uniqueOpenUsers).toBe(1);
    });
  });

  describe('calculateDeviceBreakdown', () => {
    test('should count opens by device type', () => {
      const opens = [
        { device: 'desktop' },
        { device: 'desktop' },
        { device: 'mobile' },
        { device: 'mobile' },
        { device: 'mobile' },
        { device: 'tablet' }
      ];

      const result = calculateDeviceBreakdown(opens);

      expect(result).toEqual({
        desktop: 2,
        mobile: 3,
        tablet: 1
      });
    });

    test('should ignore unknown device types', () => {
      const opens = [
        { device: 'desktop' },
        { device: 'unknown' },
        { device: 'bot' },
        { device: 'mobile' }
      ];

      const result = calculateDeviceBreakdown(opens);

      expect(result).toEqual({
        desktop: 1,
        mobile: 1,
        tablet: 0
      });
    });

    test('should handle empty opens array', () => {
      const result = calculateDeviceBreakdown([]);

      expect(result).toEqual({
        desktop: 0,
        mobile: 0,
        tablet: 0
      });
    });
  });

  describe('calculateTimingMetrics', () => {
    test('should calculate median and p95 timeToOpen and timeToClick', () => {
      const opens = [
        { timeToOpen: 100 },
        { timeToOpen: 200 },
        { timeToOpen: 300 },
        { timeToOpen: 400 },
        { timeToOpen: 500 }
      ];
      const clicks = [
        { timeToClick: 1000 },
        { timeToClick: 2000 },
        { timeToClick: 3000 }
      ];

      const result = calculateTimingMetrics(opens, clicks);

      expect(result.medianTimeToOpen).toBe(300);
      expect(result.p95TimeToOpen).toBe(500);
      expect(result.medianTimeToClick).toBe(2000);
      expect(result.p95TimeToClick).toBe(3000);
    });

    test('should calculate median for even number of values', () => {
      const opens = [
        { timeToOpen: 100 },
        { timeToOpen: 200 },
        { timeToOpen: 300 },
        { timeToOpen: 400 }
      ];
      const clicks = [
        { timeToClick: 1000 },
        { timeToClick: 2000 }
      ];

      const result = calculateTimingMetrics(opens, clicks);

      expect(result.medianTimeToOpen).toBe(250);
      expect(result.p95TimeToOpen).toBe(400);
      expect(result.medianTimeToClick).toBe(1500);
      expect(result.p95TimeToClick).toBe(2000);
    });

    test('should calculate p95 correctly for larger datasets', () => {
      const opens = [];
      for (let i = 1; i <= 100; i++) {
        opens.push({ timeToOpen: i * 10 });
      }
      const clicks = [];
      for (let i = 1; i <= 100; i++) {
        clicks.push({ timeToClick: i * 100 });
      }

      const result = calculateTimingMetrics(opens, clicks);

      expect(result.p95TimeToOpen).toBe(950);
      expect(result.p95TimeToClick).toBe(9500);
    });

    test('should filter out null values', () => {
      const opens = [
        { timeToOpen: 100 },
        { timeToOpen: null },
        { timeToOpen: 300 },
        { timeToOpen: undefined },
        {}
      ];
      const clicks = [
        { timeToClick: 1000 },
        { timeToClick: null },
        { timeToClick: 3000 }
      ];

      const result = calculateTimingMetrics(opens, clicks);

      expect(result.medianTimeToOpen).toBe(200);
      expect(result.p95TimeToOpen).toBe(300);
      expect(result.medianTimeToClick).toBe(2000);
      expect(result.p95TimeToClick).toBe(3000);
    });

    test('should return 0 for empty arrays', () => {
      const result = calculateTimingMetrics([], []);

      expect(result.medianTimeToOpen).toBe(0);
      expect(result.p95TimeToOpen).toBe(0);
      expect(result.medianTimeToClick).toBe(0);
      expect(result.p95TimeToClick).toBe(0);
    });
  });

  describe('calculateEngagementType', () => {
    test('should count new vs returning clickers', () => {
      const clicks = [
        { subscriberEmailHash: 'hash1' },
        { subscriberEmailHash: 'hash2' },
        { subscriberEmailHash: 'hash2' },
        { subscriberEmailHash: 'hash3' },
        { subscriberEmailHash: 'hash3' },
        { subscriberEmailHash: 'hash3' },
        { subscriberEmailHash: 'hash4' }
      ];

      const result = calculateEngagementType(clicks);

      expect(result.newClickers).toBe(2);
      expect(result.returningClickers).toBe(2);
    });

    test('should handle all new clickers', () => {
      const clicks = [
        { subscriberEmailHash: 'hash1' },
        { subscriberEmailHash: 'hash2' },
        { subscriberEmailHash: 'hash3' }
      ];

      const result = calculateEngagementType(clicks);

      expect(result.newClickers).toBe(3);
      expect(result.returningClickers).toBe(0);
    });

    test('should exclude unknown subscriber hashes', () => {
      const clicks = [
        { subscriberEmailHash: 'hash1' },
        { subscriberEmailHash: 'unknown' },
        { subscriberEmailHash: 'unknown' },
        { subscriberEmailHash: 'hash2' },
        { subscriberEmailHash: 'hash2' },
        { subscriberEmailHash: 'unknown' }
      ];

      const result = calculateEngagementType(clicks);

      expect(result.newClickers).toBe(1);
      expect(result.returningClickers).toBe(1);
    });

    test('should handle all unknown clicks', () => {
      const clicks = [
        { subscriberEmailHash: 'unknown' },
        { subscriberEmailHash: 'unknown' },
        { subscriberEmailHash: 'unknown' }
      ];

      const result = calculateEngagementType(clicks);

      expect(result.newClickers).toBe(0);
      expect(result.returningClickers).toBe(0);
    });

    test('should handle empty clicks array', () => {
      const result = calculateEngagementType([]);

      expect(result.newClickers).toBe(0);
      expect(result.returningClickers).toBe(0);
    });
  });

  describe('calculateTrafficSource', () => {
    test('should count clicks by traffic source', () => {
      const clicks = [
        { trafficSource: 'email' },
        { trafficSource: 'email' },
        { trafficSource: 'email' },
        { trafficSource: 'web' },
        { trafficSource: 'web' }
      ];

      const result = calculateTrafficSource(clicks);

      expect(result).toEqual({
        clicks: {
          email: 3,
          web: 2
        }
      });
    });

    test('should default missing trafficSource to web', () => {
      const clicks = [
        { trafficSource: 'email' },
        { trafficSource: null },
        {},
        { trafficSource: undefined }
      ];

      const result = calculateTrafficSource(clicks);

      expect(result).toEqual({
        clicks: {
          email: 1,
          web: 3
        }
      });
    });

    test('should handle empty clicks array', () => {
      const result = calculateTrafficSource([]);

      expect(result).toEqual({
        clicks: {
          email: 0,
          web: 0
        }
      });
    });
  });

  describe('calculateBounceReasons', () => {
    test('should count bounces by type', () => {
      const bounces = [
        { bounceType: 'permanent' },
        { bounceType: 'permanent' },
        { bounceType: 'temporary' },
        { bounceType: 'suppressed' },
        { bounceType: 'suppressed' },
        { bounceType: 'suppressed' }
      ];

      const result = calculateBounceReasons(bounces);

      expect(result).toEqual({
        permanent: 2,
        temporary: 1,
        suppressed: 3
      });
    });

    test('should default missing bounceType to temporary', () => {
      const bounces = [
        { bounceType: 'permanent' },
        { bounceType: null },
        {},
        { bounceType: undefined }
      ];

      const result = calculateBounceReasons(bounces);

      expect(result).toEqual({
        permanent: 1,
        temporary: 3,
        suppressed: 0
      });
    });

    test('should handle empty bounces array', () => {
      const result = calculateBounceReasons([]);

      expect(result).toEqual({
        permanent: 0,
        temporary: 0,
        suppressed: 0
      });
    });
  });

  describe('formatComplaintDetails', () => {
    test('should map complaints to correct format', () => {
      const complaints = [
        {
          subscriberEmailHash: 'hash1',
          timestamp: '2025-01-29T10:00:00.000Z',
          complaintType: 'spam'
        },
        {
          subscriberEmailHash: 'hash2',
          timestamp: '2025-01-29T11:00:00.000Z',
          complaintType: 'abuse'
        }
      ];

      const result = formatComplaintDetails(complaints);

      expect(result).toEqual([
        {
          email: 'hash1',
          timestamp: '2025-01-29T10:00:00.000Z',
          complaintType: 'spam'
        },
        {
          email: 'hash2',
          timestamp: '2025-01-29T11:00:00.000Z',
          complaintType: 'abuse'
        }
      ]);
    });

    test('should default missing complaintType to spam', () => {
      const complaints = [
        {
          subscriberEmailHash: 'hash1',
          timestamp: '2025-01-29T10:00:00.000Z',
          complaintType: null
        },
        {
          subscriberEmailHash: 'hash2',
          timestamp: '2025-01-29T11:00:00.000Z'
        }
      ];

      const result = formatComplaintDetails(complaints);

      expect(result[0].complaintType).toBe('spam');
      expect(result[1].complaintType).toBe('spam');
    });

    test('should cap at 100 complaints', () => {
      const complaints = [];
      for (let i = 1; i <= 150; i++) {
        complaints.push({
          subscriberEmailHash: `hash${i}`,
          timestamp: '2025-01-29T10:00:00.000Z',
          complaintType: 'spam'
        });
      }

      const result = formatComplaintDetails(complaints);

      expect(result).toHaveLength(100);
      expect(result[0].email).toBe('hash1');
      expect(result[99].email).toBe('hash100');
    });

    test('should handle empty complaints array', () => {
      const result = formatComplaintDetails([]);

      expect(result).toEqual([]);
    });
  });
});
