import { jest } from '@jest/globals';
import { handler } from '../process-link-click.mjs';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import crypto from 'crypto';
import zlib from 'zlib';

describe('process-link-click handler', () => {
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

  const createCloudWatchEvent = (logEvents) => {
    const logData = {
      logGroup: '/aws/lambda/test',
      logStream: '2025/01/29/test',
      logEvents
    };
    const compressed = zlib.gzipSync(JSON.stringify(logData));
    return {
      awslogs: {
        data: compressed.toString('base64')
      }
    };
  };

  const mockGetStats = (publishedAt) => {
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({
          Item: marshall({
            pk: 'tenant123#42',
            sk: 'stats',
            publishedAt: publishedAt || new Date().toISOString()
          })
        });
      }
      return Promise.resolve({});
    });
  };

  describe('Unit Tests - Event Record Structure', () => {
    test('should create click event with subscriber hash when provided', async () => {
      const testUrl = 'https://example.com/article';
      const timestamp = Date.now();
      const subscriberHash = 'abc123def456';
      const logEvent = {
        timestamp,
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: testUrl, src: 'email', s: subscriberHash })}`
      };

      mockGetStats(new Date(timestamp - 3600000).toISOString());

      await handler(createCloudWatchEvent([logEvent]));
      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      expect(putCalls.length).toBeGreaterThan(0);

      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item).toMatchObject({
        pk: 'tenant123#42',
        eventType: 'click',
        subscriberEmailHash: subscriberHash,
        linkUrl: testUrl,
        trafficSource: 'email',
        device: 'unknown',
        country: 'unknown'
      });
      expect(item.sk).toMatch(/^click#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#abc123def456#[a-f0-9]{8}#[A-Z0-9]{26}$/);
      expect(typeof item.timeToClick).toBe('number');
      expect(typeof item.ttl).toBe('number');
    });

    test('should default to unknown when subscriber hash not provided', async () => {
      const testUrl = 'https://example.com/article';
      const timestamp = Date.now();
      const logEvent = {
        timestamp,
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: testUrl, src: 'email' })}`
      };

      mockGetStats(new Date(timestamp - 3600000).toISOString());

      await handler(createCloudWatchEvent([logEvent]));
      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      expect(putCalls.length).toBeGreaterThan(0);

      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item).toMatchObject({
        pk: 'tenant123#42',
        eventType: 'click',
        subscriberEmailHash: 'unknown',
        linkUrl: testUrl,
        trafficSource: 'email',
        device: 'unknown',
        country: 'unknown'
      });
      expect(item.sk).toMatch(/^click#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#unknown#[a-f0-9]{8}#[A-Z0-9]{26}$/);
      expect(typeof item.timeToClick).toBe('number');
      expect(typeof item.ttl).toBe('number');
    });

    test('should include linkPosition as null when not provided', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/test' })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item.linkPosition).toBeNull();
    });

    test('should set TTL to 90 days from now', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/test' })}`
      };

      mockGetStats();
      const beforeTest = Math.floor(Date.now() / 1000);
      await handler(createCloudWatchEvent([logEvent]));
      const afterTest = Math.floor(Date.now() / 1000);

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      const expectedTTL = 90 * 24 * 60 * 60;

      expect(item.ttl).toBeGreaterThanOrEqual(beforeTest + expectedTTL);
      expect(item.ttl).toBeLessThanOrEqual(afterTest + expectedTTL + 1);
    });
  });

  describe('Unit Tests - Traffic Source Validation', () => {
    test('should accept email as valid traffic source', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/test', src: 'email' })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item.trafficSource).toBe('email');
    });

    test('should accept web as valid traffic source', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/test', src: 'web' })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item.trafficSource).toBe('web');
    });

    test('should default to web when traffic source is missing', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/test' })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item.trafficSource).toBe('web');
    });

    test('should default to web when traffic source is invalid', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/test', src: 'invalid' })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item.trafficSource).toBe('web');
    });
  });

  describe('Unit Tests - LinkId Generation', () => {
    test('should generate consistent linkId for same URL', async () => {
      const testUrl = 'https://example.com/article';
      const logEvent1 = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: testUrl })}`
      };
      const logEvent2 = {
        timestamp: Date.now() + 1000,
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: testUrl })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent1]));
      await handler(createCloudWatchEvent([logEvent2]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      expect(putCalls.length).toBeGreaterThanOrEqual(2);

      const item1 = unmarshall(putCalls[0][0].input.Item);
      const item2 = unmarshall(putCalls[1][0].input.Item);
      const linkId1 = item1.sk.split('#')[3];
      const linkId2 = item2.sk.split('#')[3];

      expect(linkId1).toBe(linkId2);
      expect(linkId1).toHaveLength(8);
      expect(linkId1).toMatch(/^[a-f0-9]{8}$/);
    });

    test('should generate different linkId for different URLs', async () => {
      const url1 = 'https://example.com/article1';
      const url2 = 'https://example.com/article2';
      const logEvent1 = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: url1 })}`
      };
      const logEvent2 = {
        timestamp: Date.now() + 1000,
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: url2 })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent1]));
      await handler(createCloudWatchEvent([logEvent2]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item1 = unmarshall(putCalls[0][0].input.Item);
      const item2 = unmarshall(putCalls[1][0].input.Item);
      const linkId1 = item1.sk.split('#')[3];
      const linkId2 = item2.sk.split('#')[3];

      expect(linkId1).not.toBe(linkId2);
    });

    test('should use MD5 hash truncated to 8 characters for linkId', async () => {
      const testUrl = 'https://example.com/test-article';
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: testUrl })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      const linkId = item.sk.split('#')[3];
      const expectedLinkId = crypto.createHash('md5').update(testUrl).digest('hex').substring(0, 8);

      expect(linkId).toBe(expectedLinkId);
    });
  });

  describe('Integration Tests - DynamoDB Operations', () => {
    test('should call PutItemCommand with correct shape for click event', async () => {
      const testUrl = 'https://example.com/article';
      const timestamp = Date.now();
      const logEvent = {
        timestamp,
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: testUrl, src: 'email' })}`
      };

      mockGetStats(new Date(timestamp - 7200000).toISOString());
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      expect(putCalls.length).toBeGreaterThan(0);

      const putCommand = putCalls[0][0];
      expect(putCommand).toBeInstanceOf(PutItemCommand);
      expect(putCommand.input.TableName).toBe('test-table');
      expect(putCommand.input.Item).toBeDefined();

      const item = unmarshall(putCommand.input.Item);
      expect(item).toHaveProperty('pk', 'tenant123#42');
      expect(item).toHaveProperty('eventType', 'click');
      expect(item).toHaveProperty('timestamp');
      expect(item).toHaveProperty('subscriberEmailHash');
      expect(item).toHaveProperty('linkUrl', testUrl);
      expect(item).toHaveProperty('linkPosition');
      expect(item).toHaveProperty('trafficSource', 'email');
      expect(item).toHaveProperty('device');
      expect(item).toHaveProperty('country');
      expect(item).toHaveProperty('timeToClick');
      expect(item).toHaveProperty('ttl');
      expect(item.sk).toMatch(/^click#/);
    });

    test('should call UpdateItemCommand for link tracking', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/test' })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const updateCalls = mockSend.mock.calls.filter(call => call[0] instanceof UpdateItemCommand);
      expect(updateCalls.length).toBeGreaterThan(0);

      const updateCommand = updateCalls[0][0];
      expect(updateCommand).toBeInstanceOf(UpdateItemCommand);
      expect(updateCommand.input.TableName).toBe('test-table');
    });

    test('should handle multiple click events in batch', async () => {
      const logEvents = [
        {
          timestamp: Date.now(),
          message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/article1', src: 'email' })}`
        },
        {
          timestamp: Date.now() + 100,
          message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/article2', src: 'web' })}`
        },
        {
          timestamp: Date.now() + 200,
          message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/article3' })}`
        }
      ];

      mockGetStats();
      const result = await handler(createCloudWatchEvent(logEvents));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      expect(putCalls.length).toBe(3);

      const items = putCalls.map(call => unmarshall(call[0].input.Item));
      expect(items[0].linkUrl).toBe('https://example.com/article1');
      expect(items[0].trafficSource).toBe('email');
      expect(items[1].linkUrl).toBe('https://example.com/article2');
      expect(items[1].trafficSource).toBe('web');
      expect(items[2].linkUrl).toBe('https://example.com/article3');
      expect(items[2].trafficSource).toBe('web');

      const response = JSON.parse(result.body);
      expect(response.processed).toBeGreaterThanOrEqual(3);
    });

    test('should set timeToClick to null when publishedAt is missing', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({ cid: 'tenant123#42', u: 'https://example.com/test' })}`
      };

      mockSend.mockImplementation((command) => {
        if (command instanceof GetItemCommand) {
          return Promise.resolve({
            Item: marshall({ pk: 'tenant123#42', sk: 'stats' })
          });
        }
        return Promise.resolve({});
      });

      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item.timeToClick).toBeNull();
    });
  });

  describe('Unit Tests - Geolocation Integration', () => {
    test('should include country field in click event', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({
          cid: 'tenant123#42',
          u: 'https://example.com/test',
          ip: '203.0.113.1'
        })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item).toHaveProperty('country');
      expect(typeof item.country).toBe('string');
    });

    test('should handle missing IP with country unknown', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({
          cid: 'tenant123#42',
          u: 'https://example.com/test'
        })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item.country).toBe('unknown');
    });

    test('should not store IP address in event', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({
          cid: 'tenant123#42',
          u: 'https://example.com/test',
          ip: '8.8.8.8',
          xff: '203.0.113.1'
        })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);

      expect(item).not.toHaveProperty('ip');
      expect(item).not.toHaveProperty('xff');
      expect(JSON.stringify(item)).not.toContain('8.8.8.8');
      expect(JSON.stringify(item)).not.toContain('203.0.113.1');
    });

    test('should handle private IP addresses gracefully', async () => {
      const logEvent = {
        timestamp: Date.now(),
        message: `INFO ${JSON.stringify({
          cid: 'tenant123#42',
          u: 'https://example.com/test',
          ip: '10.0.0.1'
        })}`
      };

      mockGetStats();
      await handler(createCloudWatchEvent([logEvent]));

      const putCalls = mockSend.mock.calls.filter(call => call[0] instanceof PutItemCommand);
      const item = unmarshall(putCalls[0][0].input.Item);
      expect(item.country).toBe('unknown');
    });
  });
});
