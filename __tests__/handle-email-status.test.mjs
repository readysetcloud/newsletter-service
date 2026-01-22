import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let ddbSend;
let PutItemCommand;
let UpdateItemCommand;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: (obj) => {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') {
            result[key] = { S: value };
          } else if (typeof value === 'number') {
            result[key] = { N: String(value) };
          } else if (Array.isArray(value)) {
            result[key] = { L: value.map(v => ({ S: v })) };
          }
        }
        return result;
      },
    }));

    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      hash: jest.fn((str) => `hash_${str}`),
    }));

    ({ handler } = await import('../functions/handle-email-status.mjs'));
    ({ PutItemCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb'));
  });
};

describe('handle-email-status', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  describe('Open event tracking', () => {
    it('should track first open with userAgent and ipAddress', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com']
          },
          open: {
            timestamp: '2025-01-21T10:30:00.000Z',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
            ipAddress: '192.0.2.1'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(2);

      const putCall = ddbSend.mock.calls[0][0];
      expect(putCall.__type).toBe('PutItem');
      expect(putCall.Item.pk.S).toBe('tenant123#issue-456');
      expect(putCall.Item.sk.S).toBe('opens#subscriber@example.com');
      expect(putCall.Item.userAgent.S).toBe('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)');
      expect(putCall.Item.ipAddress.S).toBe('192.0.2.1');
      expect(putCall.Item.openedAt.S).toBe('2025-01-21T10:30:00.000Z');
      expect(putCall.Item.createdAt.S).toBeDefined();
      expect(putCall.Item.ttl.N).toBeDefined();

      const updateCall = ddbSend.mock.calls[1][0];
      expect(updateCall.__type).toBe('UpdateItem');
    });

    it('should track first open without optional fields', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com']
          },
          open: {}
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);

      const putCall = ddbSend.mock.calls[0][0];
      expect(putCall.Item.pk.S).toBe('tenant123#issue-456');
      expect(putCall.Item.sk.S).toBe('opens#subscriber@example.com');
      expect(putCall.Item.userAgent).toBeUndefined();
      expect(putCall.Item.ipAddress).toBeUndefined();
      expect(putCall.Item.openedAt).toBeUndefined();
      expect(putCall.Item.createdAt.S).toBeDefined();
    });

    it('should detect reopens and increment reopens stat', async () => {
      const conditionalError = new Error('ConditionalCheckFailedException');
      conditionalError.name = 'ConditionalCheckFailedException';

      ddbSend.mockRejectedValueOnce(conditionalError);
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com']
          },
          open: {
            timestamp: '2025-01-21T11:30:00.000Z',
            userAgent: 'Mozilla/5.0',
            ipAddress: '192.0.2.1'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(2);

      const updateCall = ddbSend.mock.calls[1][0];
      expect(updateCall.__type).toBe('UpdateItem');
      expect(updateCall.ExpressionAttributeNames['#stat']).toBe('reopens');
    });
  });

  describe('Other event types', () => {
    it('should handle bounce events', async () => {
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(1);
    });

    it('should handle delivery events', async () => {
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Delivery',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['delivered@example.com']
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(1);
    });

    it('should handle click events', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Click',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['clicker@example.com']
          },
          click: {
            link: 'https://example.com/article',
            ipAddress: '192.0.2.1'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    it('should return early if no reference number', async () => {
      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {},
            destination: ['subscriber@example.com']
          }
        }
      };

      const result = await handler(event);

      expect(result).toBeUndefined();
      expect(ddbSend).not.toHaveBeenCalled();
    });

    it('should handle unsupported event types', async () => {
      const event = {
        detail: {
          eventType: 'Unknown',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com']
          }
        }
      };

      const result = await handler(event);

      expect(result).toBeUndefined();
      expect(ddbSend).not.toHaveBeenCalled();
    });

    it('should return false on unexpected errors', async () => {
      ddbSend.mockRejectedValueOnce(new Error('Unexpected error'));

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com']
          },
          open: {}
        }
      };

      const result = await handler(event);

      expect(result).toBe(false);
    });
  });
});
