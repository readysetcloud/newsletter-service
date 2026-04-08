import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let ddbSend;
let eventBridgeSend;
let mockGetMostRecentPublishedIssue;
let mockIncrementIssueCounter;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();
    eventBridgeSend = jest.fn();
    mockGetMostRecentPublishedIssue = jest.fn();
    mockIncrementIssueCounter = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      DeleteItemCommand: jest.fn((params) => ({ __type: 'DeleteItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
      EventBridgeClient: jest.fn(() => ({ send: eventBridgeSend })),
      PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params })),
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
          } else if (value.L !== undefined) {
            result[key] = value.L.map(v => v.S);
          }
        }
        return result;
      }),
    }));

    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      getTenant: jest.fn(async (tenantId) => ({
        pk: `${tenantId}#tenant`,
        list: 'test-contact-list',
        email: 'admin@example.com'
      })),
      sendWithRetry: jest.fn(async (fn) => fn()),
      throttle: jest.fn(async (tasks) => {
        for (const task of tasks) {
          await task();
        }
      }),
    }));

    jest.unstable_mockModule('../functions/utils/issue-attribution.mjs', () => ({
      getMostRecentPublishedIssue: mockGetMostRecentPublishedIssue,
      incrementIssueCounter: mockIncrementIssueCounter,
    }));

    ({ handler } = await import('../functions/subscribers/clean-bounced-subscribers.mjs'));
  });
};

describe('clean-bounced-subscribers', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    await loadIsolated();
  });

  describe('attribution-based cleaned counter', () => {
    it('should call getMostRecentPublishedIssue once and incrementIssueCounter per successful removal', async () => {
      mockGetMostRecentPublishedIssue.mockResolvedValue({ pk: 'tenant123#42', issueNumber: 42 });
      mockIncrementIssueCounter.mockResolvedValue(undefined);

      ddbSend
        // loadStatsRecord(currentIssue)
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#42' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }, { S: 'bounce2@example.com' }] }
          }
        })
        // loadStatsRecord(previousIssue)
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#41' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }, { S: 'bounce2@example.com' }] }
          }
        })
        // DeleteItemCommand for bounce1 (successful)
        .mockResolvedValueOnce({ Attributes: { email: { S: 'bounce1@example.com' } } })
        // DeleteItemCommand for bounce2 (successful)
        .mockResolvedValueOnce({ Attributes: { email: { S: 'bounce2@example.com' } } })
        // updateSubscriberCount query
        .mockResolvedValueOnce({ Count: 10 })
        // updateSubscriberCount update
        .mockResolvedValueOnce({})
        // eventBridge send
        ;
      eventBridgeSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          currentIssue: 'tenant123#42',
          previousIssue: 'tenant123#41',
          tenantId: { id: 'tenant123' }
        }
      };

      await handler(event);

      // Attribution lookup called once
      expect(mockGetMostRecentPublishedIssue).toHaveBeenCalledTimes(1);
      expect(mockGetMostRecentPublishedIssue).toHaveBeenCalledWith('tenant123');

      // incrementIssueCounter called once per successful removal
      expect(mockIncrementIssueCounter).toHaveBeenCalledTimes(2);
      expect(mockIncrementIssueCounter).toHaveBeenCalledWith('tenant123#42', 'cleaned');
    });

    it('should not increment counter when no published issue found', async () => {
      mockGetMostRecentPublishedIssue.mockResolvedValue(null);

      ddbSend
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#42' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }] }
          }
        })
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#41' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }] }
          }
        })
        .mockResolvedValueOnce({ Attributes: { email: { S: 'bounce1@example.com' } } })
        .mockResolvedValueOnce({ Count: 10 })
        .mockResolvedValueOnce({});
      eventBridgeSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          currentIssue: 'tenant123#42',
          previousIssue: 'tenant123#41',
          tenantId: { id: 'tenant123' }
        }
      };

      await handler(event);

      expect(mockGetMostRecentPublishedIssue).toHaveBeenCalledTimes(1);
      expect(mockIncrementIssueCounter).not.toHaveBeenCalled();
    });

    it('should not fail cleanup when incrementIssueCounter throws', async () => {
      mockGetMostRecentPublishedIssue.mockResolvedValue({ pk: 'tenant123#42', issueNumber: 42 });
      mockIncrementIssueCounter.mockRejectedValue(new Error('DynamoDB error'));

      ddbSend
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#42' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }] }
          }
        })
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#41' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }] }
          }
        })
        .mockResolvedValueOnce({ Attributes: { email: { S: 'bounce1@example.com' } } })
        .mockResolvedValueOnce({ Count: 10 })
        .mockResolvedValueOnce({});
      eventBridgeSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          currentIssue: 'tenant123#42',
          previousIssue: 'tenant123#41',
          tenantId: { id: 'tenant123' }
        }
      };

      // Should not throw despite incrementIssueCounter failing
      await expect(handler(event)).resolves.not.toThrow();

      expect(mockIncrementIssueCounter).toHaveBeenCalledTimes(1);
    });

    it('should not fail cleanup when getMostRecentPublishedIssue throws', async () => {
      mockGetMostRecentPublishedIssue.mockRejectedValue(new Error('Query failed'));

      ddbSend
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#42' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }] }
          }
        })
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#41' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }] }
          }
        })
        .mockResolvedValueOnce({ Attributes: { email: { S: 'bounce1@example.com' } } })
        .mockResolvedValueOnce({ Count: 10 })
        .mockResolvedValueOnce({});
      eventBridgeSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          currentIssue: 'tenant123#42',
          previousIssue: 'tenant123#41',
          tenantId: { id: 'tenant123' }
        }
      };

      await expect(handler(event)).resolves.not.toThrow();

      expect(mockIncrementIssueCounter).not.toHaveBeenCalled();
    });

    it('should not count already-absent subscribers and not increment for them', async () => {
      mockGetMostRecentPublishedIssue.mockResolvedValue({ pk: 'tenant123#42', issueNumber: 42 });
      mockIncrementIssueCounter.mockResolvedValue(undefined);

      ddbSend
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#42' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }, { S: 'bounce2@example.com' }] }
          }
        })
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#41' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce1@example.com' }, { S: 'bounce2@example.com' }] }
          }
        })
        // bounce1 already absent (no Attributes returned)
        .mockResolvedValueOnce({})
        // bounce2 successfully deleted
        .mockResolvedValueOnce({ Attributes: { email: { S: 'bounce2@example.com' } } })
        .mockResolvedValueOnce({ Count: 10 })
        .mockResolvedValueOnce({});
      eventBridgeSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          currentIssue: 'tenant123#42',
          previousIssue: 'tenant123#41',
          tenantId: { id: 'tenant123' }
        }
      };

      await handler(event);

      // Only 1 increment for the actually-removed subscriber
      expect(mockIncrementIssueCounter).toHaveBeenCalledTimes(1);
      expect(mockIncrementIssueCounter).toHaveBeenCalledWith('tenant123#42', 'cleaned');
    });

    it('should proceed with cleanup even when cleaned field already exists on stats record', async () => {
      // With the old code, having `cleaned` defined would skip cleanup (idempotency).
      // The new code no longer checks for this — it always proceeds.
      mockGetMostRecentPublishedIssue.mockResolvedValue({ pk: 'tenant123#42', issueNumber: 42 });
      mockIncrementIssueCounter.mockResolvedValue(undefined);

      ddbSend
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#42' },
            sk: { S: 'stats' },
            cleaned: { N: '2' },
            failedAddresses: { L: [{ S: 'bounce@example.com' }] }
          }
        })
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant123#41' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce@example.com' }] }
          }
        })
        .mockResolvedValueOnce({ Attributes: { email: { S: 'bounce@example.com' } } })
        .mockResolvedValueOnce({ Count: 10 })
        .mockResolvedValueOnce({});
      eventBridgeSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          currentIssue: 'tenant123#42',
          previousIssue: 'tenant123#41',
          tenantId: { id: 'tenant123' }
        }
      };

      await handler(event);

      // Cleanup should proceed — delete was called
      const deleteCalls = ddbSend.mock.calls.filter(call => call[0].__type === 'DeleteItem');
      expect(deleteCalls.length).toBe(1);
      expect(mockIncrementIssueCounter).toHaveBeenCalledTimes(1);
    });
  });
});
