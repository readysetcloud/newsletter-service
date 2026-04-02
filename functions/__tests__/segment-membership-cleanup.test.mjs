import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

let handler;
let ddbSend;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      DeleteItemCommand: jest.fn((params) => ({ __type: 'Delete', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'Update', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: (obj) => {
        const r = {};
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') r[k] = { S: v };
          else if (typeof v === 'number') r[k] = { N: String(v) };
        }
        return r;
      },
      unmarshall: (item) => {
        const r = {};
        for (const [k, v] of Object.entries(item)) {
          if (v.S !== undefined) r[k] = v.S;
          else if (v.N !== undefined) r[k] = Number(v.N);
        }
        return r;
      },
    }));

    jest.unstable_mockModule('../utils/helpers.mjs', () => ({
      sendWithRetry: jest.fn((fn) => fn()),
    }));

    ({ handler } = await import('../subscribers/segment-membership-cleanup.mjs'));
  });
};

describe('segment-membership-cleanup', () => {
  let originalEnv;

  beforeEach(async () => {
    jest.resetModules();
    originalEnv = { ...process.env };
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    await loadIsolated();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Validates: Requirements 10.1, 10.2
   */
  it('skips non-REMOVE events', async () => {
    const event = {
      Records: [
        { eventName: 'INSERT', dynamodb: { OldImage: { tenantId: { S: 't1' }, email: { S: 'a@t.com' } } } },
        { eventName: 'MODIFY', dynamodb: { OldImage: { tenantId: { S: 't1' }, email: { S: 'b@t.com' } } } },
      ],
    };
    await handler(event);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  /**
   * Validates: Requirements 10.1, 10.2
   */
  it('skips REMOVE events for segment records', async () => {
    const event = {
      Records: [
        {
          eventName: 'REMOVE',
          dynamodb: { OldImage: { tenantId: { S: 't1' }, email: { S: 'SEGMENT#seg1' } } },
        },
        {
          eventName: 'REMOVE',
          dynamodb: { OldImage: { tenantId: { S: 't1' }, email: { S: 'SEGMENT#seg1#MEMBER#a@t.com' } } },
        },
      ],
    };
    await handler(event);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  /**
   * Validates: Requirements 10.1, 10.2
   */
  it('skips REMOVE events with no OldImage', async () => {
    const event = { Records: [{ eventName: 'REMOVE', dynamodb: {} }] };
    await handler(event);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  /**
   * Validates: Requirements 10.1, 10.2
   */
  it('cleans up memberships when a subscriber is deleted', async () => {
    const event = {
      Records: [{
        eventName: 'REMOVE',
        dynamodb: { OldImage: { tenantId: { S: 't1' }, email: { S: 'user@t.com' } } },
      }],
    };

    // GSI query returns two memberships
    ddbSend.mockResolvedValueOnce({
      Items: [
        { tenantId: { S: 't1' }, email: { S: 'SEGMENT#seg1#MEMBER#user@t.com' }, memberEmail: { S: 'user@t.com' } },
        { tenantId: { S: 't1' }, email: { S: 'SEGMENT#seg2#MEMBER#user@t.com' }, memberEmail: { S: 'user@t.com' } },
      ],
    });
    ddbSend.mockResolvedValueOnce({}); // delete membership 1
    ddbSend.mockResolvedValueOnce({}); // delete membership 2
    ddbSend.mockResolvedValueOnce({}); // decrement seg1
    ddbSend.mockResolvedValueOnce({}); // decrement seg2

    await handler(event);

    expect(ddbSend).toHaveBeenCalledTimes(5);
    expect(ddbSend.mock.calls[1][0].__type).toBe('Delete');
    expect(ddbSend.mock.calls[2][0].__type).toBe('Delete');
    expect(ddbSend.mock.calls[3][0].__type).toBe('Update');
    expect(ddbSend.mock.calls[4][0].__type).toBe('Update');
  });

  /**
   * Validates: Requirements 10.1, 10.2
   */
  it('handles subscriber with no segment memberships', async () => {
    const event = {
      Records: [{
        eventName: 'REMOVE',
        dynamodb: { OldImage: { tenantId: { S: 't1' }, email: { S: 'lonely@t.com' } } },
      }],
    };
    ddbSend.mockResolvedValueOnce({ Items: [] });
    await handler(event);
    expect(ddbSend).toHaveBeenCalledTimes(1);
  });

  /**
   * Validates: Requirements 10.6
   */
  it('floors memberCount at zero when decrement would go negative', async () => {
    const event = {
      Records: [{
        eventName: 'REMOVE',
        dynamodb: { OldImage: { tenantId: { S: 't1' }, email: { S: 'user@t.com' } } },
      }],
    };

    ddbSend.mockResolvedValueOnce({
      Items: [
        { tenantId: { S: 't1' }, email: { S: 'SEGMENT#seg1#MEMBER#user@t.com' }, memberEmail: { S: 'user@t.com' } },
      ],
    });
    ddbSend.mockResolvedValueOnce({}); // delete membership
    const condErr = new Error('conditional');
    condErr.name = 'ConditionalCheckFailedException';
    ddbSend.mockRejectedValueOnce(condErr); // decrement fails
    ddbSend.mockResolvedValueOnce({}); // set to zero

    await handler(event);

    expect(ddbSend).toHaveBeenCalledTimes(4);
    const setZero = ddbSend.mock.calls[3][0];
    expect(setZero.__type).toBe('Update');
    expect(setZero.UpdateExpression).toBe('SET memberCount = :zero');
  });

  /**
   * Validates: Requirements 10.1, 10.2
   */
  it('handles paginated GSI query results', async () => {
    const event = {
      Records: [{
        eventName: 'REMOVE',
        dynamodb: { OldImage: { tenantId: { S: 't1' }, email: { S: 'user@t.com' } } },
      }],
    };

    ddbSend.mockResolvedValueOnce({
      Items: [
        { tenantId: { S: 't1' }, email: { S: 'SEGMENT#seg1#MEMBER#user@t.com' }, memberEmail: { S: 'user@t.com' } },
      ],
      LastEvaluatedKey: { tenantId: { S: 't1' }, memberEmail: { S: 'user@t.com' } },
    });
    ddbSend.mockResolvedValueOnce({
      Items: [
        { tenantId: { S: 't1' }, email: { S: 'SEGMENT#seg2#MEMBER#user@t.com' }, memberEmail: { S: 'user@t.com' } },
      ],
    });
    ddbSend.mockResolvedValueOnce({}); // delete seg1 membership
    ddbSend.mockResolvedValueOnce({}); // delete seg2 membership
    ddbSend.mockResolvedValueOnce({}); // decrement seg1
    ddbSend.mockResolvedValueOnce({}); // decrement seg2

    await handler(event);

    expect(ddbSend).toHaveBeenCalledTimes(6);
  });
});
