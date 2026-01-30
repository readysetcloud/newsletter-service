import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let ddbSend;
let sesSend;
let eventBridgeSend;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();
    sesSend = jest.fn();
    eventBridgeSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => ({ send: sesSend })),
      DeleteContactCommand: jest.fn((params) => ({ __type: 'DeleteContact', ...params })),
      ListContactsCommand: jest.fn((params) => ({ __type: 'ListContacts', ...params })),
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

    ({ handler } = await import('../functions/subscribers/clean-bounced-subscribers.mjs'));
  });
};

describe('clean-bounced-subscribers', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  describe('GSI backfill', () => {
    it('should add GSI attributes when updating cleaned count', async () => {
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
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Contacts: [] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const event = {
        detail: {
          currentIssue: 'tenant123#42',
          previousIssue: 'tenant123#41',
          tenantId: { id: 'tenant123' }
        }
      };

      await handler(event);

      const updateCalls = ddbSend.mock.calls.filter(call => call[0].__type === 'UpdateItem');
      const cleanedUpdate = updateCalls.find(call =>
        call[0].UpdateExpression && call[0].UpdateExpression.includes('cleaned')
      );

      expect(cleanedUpdate).toBeDefined();
      expect(cleanedUpdate[0].UpdateExpression).toContain('GSI1PK = if_not_exists(GSI1PK, :gsi1pk)');
      expect(cleanedUpdate[0].UpdateExpression).toContain('GSI1SK = if_not_exists(GSI1SK, :gsi1sk)');
      expect(cleanedUpdate[0].ExpressionAttributeValues[':gsi1pk'].S).toBe('tenant123#issue');
      expect(cleanedUpdate[0].ExpressionAttributeValues[':gsi1sk'].S).toBe('00042');
    });

    it('should pad issue numbers correctly', async () => {
      ddbSend
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant456#7' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce@example.com' }] }
          }
        })
        .mockResolvedValueOnce({
          Item: {
            pk: { S: 'tenant456#6' },
            sk: { S: 'stats' },
            failedAddresses: { L: [{ S: 'bounce@example.com' }] }
          }
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Contacts: [] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const event = {
        detail: {
          currentIssue: 'tenant456#7',
          previousIssue: 'tenant456#6',
          tenantId: { id: 'tenant456' }
        }
      };

      await handler(event);

      const updateCalls = ddbSend.mock.calls.filter(call => call[0].__type === 'UpdateItem');
      const cleanedUpdate = updateCalls.find(call =>
        call[0].UpdateExpression && call[0].UpdateExpression.includes('cleaned')
      );

      expect(cleanedUpdate[0].ExpressionAttributeValues[':gsi1sk'].S).toBe('00007');
    });

    it('should skip cleanup if already completed', async () => {
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
        });

      const event = {
        detail: {
          currentIssue: 'tenant123#42',
          previousIssue: 'tenant123#41',
          tenantId: { id: 'tenant123' }
        }
      };

      await handler(event);

      expect(sesSend).not.toHaveBeenCalled();
    });
  });
});
