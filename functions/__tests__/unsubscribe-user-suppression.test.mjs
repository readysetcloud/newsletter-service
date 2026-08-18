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
      TransactWriteItemsCommand: jest.fn((params) => ({ __type: 'TransactWrite', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    ({ unsubscribeUser } = await import('../utils/subscriber.mjs'));
  });
}

/** A cancelled transaction with the given per-item reason codes. */
const cancelWith = (codes) => Object.assign(new Error('cancelled'), {
  name: 'TransactionCanceledException',
  CancellationReasons: codes.map((Code) => ({ Code }))
});

describe('unsubscribeUser suppression trail', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'newsletter-table';
    process.env.SUBSCRIBERS_TABLE_NAME = 'subscribers-table';
    await loadIsolated();
  });

  test('records the revocation before removing the subscriber', async () => {
    ddbSend.mockResolvedValue({});

    const result = await unsubscribeUser('tenant1', 'A@B.com', 'one-click', {
      ipAddress: '10.0.0.1',
      userAgent: 'ua'
    });

    expect(result).toEqual({ success: true, actuallyRemoved: true });

    const calls = ddbSend.mock.calls.map(([cmd]) => cmd);
    // Suppression first: a crash after it still leaves the revocation on record.
    expect(calls[0].__type).toBe('UpdateItem');
    expect(calls[0].TableName).toBe('newsletter-table');
    expect(calls[0].Key.sk).toBe('suppression#a@b.com');
    expect(calls[0].ExpressionAttributeValues[':method']).toBe('one-click');
    expect(calls[1].__type).toBe('TransactWrite');
  });

  // The removal and the count are one commit. Splitting them drifted: a delete
  // that succeeded followed by a failed decrement reported failure for an
  // unsubscribe that had happened, and the retry found nothing left to delete
  // so the count was never repaired.
  test('removes the subscriber and decrements the count in one transaction', async () => {
    ddbSend.mockResolvedValue({});

    await unsubscribeUser('tenant1', 'a@b.com', 'one-click');

    const transaction = ddbSend.mock.calls
      .map(([cmd]) => cmd)
      .find((cmd) => cmd.__type === 'TransactWrite');

    expect(transaction.TransactItems).toHaveLength(2);
    expect(transaction.TransactItems[0].Delete.TableName).toBe('subscribers-table');
    expect(transaction.TransactItems[0].Delete.ConditionExpression).toBe('attribute_exists(tenantId)');
    expect(transaction.TransactItems[1].Update.TableName).toBe('newsletter-table');
    expect(transaction.TransactItems[1].Update.UpdateExpression).toContain('- :dec');
  });

  // An unsubscribe click on an old email after the address already left the
  // list is still a statement about future sends — it must survive as a
  // suppression even though there is nothing to delete.
  test('records the revocation even when the address is not on the list', async () => {
    ddbSend.mockImplementation((cmd) =>
      cmd.__type === 'TransactWrite'
        ? Promise.reject(cancelWith(['ConditionalCheckFailed', 'None']))
        : Promise.resolve({})
    );

    const result = await unsubscribeUser('tenant1', 'gone@b.com', 'encrypted-link');

    expect(result).toEqual({ success: true, actuallyRemoved: false });
    const suppressionWrite = ddbSend.mock.calls
      .map(([cmd]) => cmd)
      .find((cmd) => cmd.__type === 'UpdateItem');
    expect(suppressionWrite.Key.sk).toBe('suppression#gone@b.com');
  });

  // A stored count of zero alongside a live subscriber row means the number is
  // already wrong. Refusing the unsubscribe over it would punish the person
  // opting out for a bookkeeping error, so the removal proceeds alone.
  test('still removes the subscriber when the count is already at zero', async () => {
    ddbSend.mockImplementation((cmd) => {
      if (cmd.__type === 'TransactWrite') {
        return Promise.reject(cancelWith(['None', 'ConditionalCheckFailed']));
      }
      if (cmd.__type === 'DeleteItem') {
        return Promise.resolve({ Attributes: { email: 'a@b.com' } });
      }
      return Promise.resolve({});
    });

    const result = await unsubscribeUser('tenant1', 'a@b.com', 'one-click');

    expect(result).toEqual({ success: true, actuallyRemoved: true });
    const fallback = ddbSend.mock.calls
      .map(([cmd]) => cmd)
      .find((cmd) => cmd.__type === 'DeleteItem');
    expect(fallback.ReturnValues).toBe('ALL_OLD');
  });

  // The row can go between the cancelled transaction and the fallback delete —
  // a concurrent unsubscribe of the same address. Reporting a removal on an
  // empty delete would let both requests credit the issue's `unsubscribes`
  // counter for one person leaving.
  test('reports nothing removed when the fallback delete finds no row', async () => {
    ddbSend.mockImplementation((cmd) =>
      cmd.__type === 'TransactWrite'
        ? Promise.reject(cancelWith(['None', 'ConditionalCheckFailed']))
        : Promise.resolve({})
    );

    const result = await unsubscribeUser('tenant1', 'a@b.com', 'one-click');

    expect(result).toEqual({ success: true, actuallyRemoved: false });
  });

  // A cancellation that is neither guard is a real failure, not a no-op.
  test('reports a transaction conflict as a failure', async () => {
    ddbSend.mockImplementation((cmd) =>
      cmd.__type === 'TransactWrite'
        ? Promise.reject(cancelWith(['TransactionConflict', 'None']))
        : Promise.resolve({})
    );

    const result = await unsubscribeUser('tenant1', 'a@b.com', 'one-click');

    expect(result).toEqual({ success: false, actuallyRemoved: false });
  });

  // Fails closed. Removing the subscriber anyway would report a durable
  // unsubscribe with no record of it, and the next list import would put that
  // person straight back on — the exact failure the record exists to prevent.
  // Leaving them subscribed and reporting failure means the provider retries.
  test('a failed suppression write aborts the removal', async () => {
    ddbSend.mockImplementation((cmd) => {
      if (cmd.__type === 'UpdateItem') {
        return Promise.reject(new Error('DynamoDB down'));
      }
      return Promise.resolve({});
    });

    const result = await unsubscribeUser('tenant1', 'a@b.com', 'complaint');

    expect(result).toEqual({ success: false, actuallyRemoved: false });
    const types = ddbSend.mock.calls.map(([cmd]) => cmd.__type);
    expect(types).not.toContain('TransactWrite');
    expect(types).not.toContain('DeleteItem');
  });
});
