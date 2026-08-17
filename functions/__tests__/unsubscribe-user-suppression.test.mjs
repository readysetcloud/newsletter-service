import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let unsubscribeUser;
let ddbSend;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      // suppression.mjs constructs its own client; prototype patching does not
      // reach it, so both modules share this mocked constructor instead.
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      DeleteItemCommand: jest.fn((params) => ({ __type: 'DeleteItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    ({ unsubscribeUser } = await import('../utils/subscriber.mjs'));
  });
}

describe('unsubscribeUser suppression trail', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'newsletter-table';
    process.env.SUBSCRIBERS_TABLE_NAME = 'subscribers-table';
    await loadIsolated();
  });

  test('records the revocation before deleting the subscriber', async () => {
    ddbSend.mockResolvedValue({ Attributes: { email: 'a@b.com' } });

    const result = await unsubscribeUser('tenant1', 'A@B.com', 'one-click', {
      ipAddress: '10.0.0.1',
      userAgent: 'ua'
    });

    expect(result).toEqual({ success: true, actuallyRemoved: true });

    const calls = ddbSend.mock.calls.map(([cmd]) => cmd);
    // Suppression first: a crash after it still leaves the revocation on record.
    expect(calls[0].__type).toBe('PutItem');
    expect(calls[0].TableName).toBe('newsletter-table');
    expect(calls[0].Item.sk).toBe('suppression#a@b.com');
    expect(calls[0].Item.method).toBe('one-click');
    expect(calls[1].__type).toBe('DeleteItem');
    expect(calls[1].TableName).toBe('subscribers-table');
  });

  // An unsubscribe click on an old email after the address already left the
  // list is still a statement about future sends — it must survive as a
  // suppression even though there is nothing to delete.
  test('records the revocation even when the address is not on the list', async () => {
    ddbSend.mockImplementation((cmd) =>
      Promise.resolve(cmd.__type === 'DeleteItem' ? {} : {})
    );

    const result = await unsubscribeUser('tenant1', 'gone@b.com', 'encrypted-link');

    expect(result).toEqual({ success: true, actuallyRemoved: false });
    const suppressionWrite = ddbSend.mock.calls
      .map(([cmd]) => cmd)
      .find((cmd) => cmd.__type === 'PutItem');
    expect(suppressionWrite.Item.sk).toBe('suppression#gone@b.com');
  });

  test('a failed suppression write does not block the removal', async () => {
    ddbSend.mockImplementation((cmd) => {
      if (cmd.__type === 'PutItem') {
        return Promise.reject(new Error('DynamoDB down'));
      }
      return Promise.resolve(cmd.__type === 'DeleteItem' ? { Attributes: { email: 'a@b.com' } } : {});
    });

    const result = await unsubscribeUser('tenant1', 'a@b.com', 'complaint');

    expect(result).toEqual({ success: true, actuallyRemoved: true });
    expect(ddbSend.mock.calls.map(([cmd]) => cmd.__type)).toContain('DeleteItem');
  });
});
