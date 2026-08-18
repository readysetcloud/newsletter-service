import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let getSuppression;
let ddbSend;
let getTenant;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn().mockResolvedValue({ Count: 0 });
    getTenant = jest.fn().mockResolvedValue({ pk: 'tenant1' });
    getSuppression = jest.fn().mockResolvedValue(null);

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      // A transaction, not a batch write: it commits the consent ConditionCheck
      // with the subscriber Put, and unlike BatchWriteItem it supports the
      // condition that stops a re-import overwriting a live subscriber row.
      TransactWriteItemsCommand: jest.fn((params) => ({ __type: 'TransactWrite', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      getTenant,
      formatResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      throttle: async (tasks) => { for (const task of tasks) await task(); },
      sendWithRetry: async (fn) => await fn(),
    }));

    jest.unstable_mockModule('../functions/utils/suppression.mjs', () => ({
      getSuppression,
      suppressionConditionCheck: jest.fn((tenantId, email) => ({
        ConditionCheck: {
          TableName: 'newsletter-table',
          Key: { pk: tenantId, sk: `suppression#${email}` },
          ConditionExpression: 'attribute_not_exists(pk)'
        }
      })),
    }));

    ({ handler } = await import('../functions/subscribers/import-subscriber-list.mjs'));
  });
}

// An import is the operator acting, not the subscriber, so it cannot restore
// consent: a list snapshot that predates someone's unsubscribe must not put
// them back on the list.
describe('import-subscriber-list suppression', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'newsletter-table';
    process.env.SUBSCRIBERS_TABLE_NAME = 'subscribers-table';
    await loadIsolated();
  });

  const importEvent = (addresses) => ({
    tenantId: 'tenant1',
    list: { items: addresses.map((address) => ({ address })) }
  });

  test('skips unsubscribed addresses and names them in the result', async () => {
    getSuppression.mockImplementation(async (tenantId, email) =>
      email === 'optedout@example.com'
        ? { unsubscribedAt: '2026-08-01T00:00:00.000Z', method: 'one-click' }
        : null
    );

    const result = await handler(importEvent(['keep@example.com', 'OptedOut@example.com']));

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(result.suppressedAddresses).toEqual(['optedout@example.com']);

    // Only the non-suppressed address was written.
    const writes = ddbSend.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd) => cmd.__type === 'TransactWrite');
    expect(writes).toHaveLength(1);
    expect(writes[0].TransactItems[1].Put.Item.email).toBe('keep@example.com');
  });

  test('imports everything when nothing is suppressed', async () => {
    const result = await handler(importEvent(['a@example.com', 'b@example.com']));

    expect(result.success).toBe(true);
    expect(result.imported).toBe(2);
    expect(result.existing).toBe(0);
    expect(result.suppressed).toBe(0);
  });

  // `imported` used to be total minus failures minus suppressions, so a
  // re-import of a list that was already on the system reported every address
  // as a fresh import even though nothing was written.
  test('reports addresses that were already subscribed separately', async () => {
    ddbSend.mockImplementation((cmd) => {
      if (cmd.__type !== 'TransactWrite') {
        return Promise.resolve({ Count: 0 });
      }
      const email = cmd.TransactItems[1].Put.Item.email;
      if (email === 'already@example.com') {
        return Promise.reject(Object.assign(new Error('exists'), {
          name: 'TransactionCanceledException',
          CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }]
        }));
      }
      return Promise.resolve({});
    });

    const result = await handler(importEvent(['fresh@example.com', 'already@example.com']));

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.existing).toBe(1);
    expect(result.total).toBe(2);
  });

  // The count moves with the row that changed it. The import used to recount
  // the whole partition at the end and SET the absolute total, which raced
  // with live traffic: a signup committing between the recount's Query and its
  // write was erased by the stale total. Strong consistency does not help —
  // it says what was true when the Query ran, not that it stays true.
  test('increments the tenant count inside each address transaction', async () => {
    await handler(importEvent(['a@example.com', 'b@example.com']));

    const writes = ddbSend.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd) => cmd.__type === 'TransactWrite');

    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.TransactItems).toHaveLength(3);
      expect(write.TransactItems[2].Update.Key).toEqual({ pk: 'tenant1', sk: 'tenant' });
      expect(write.TransactItems[2].Update.UpdateExpression)
        .toBe('SET #subscribers = if_not_exists(#subscribers, :zero) + :one');
    }
  });

  test('never overwrites the tenant count from a separate snapshot', async () => {
    await handler(importEvent(['a@example.com']));

    const commands = ddbSend.mock.calls.map(([cmd]) => cmd);
    // No end-of-import recount, and no absolute SET of the count outside the
    // per-address transactions.
    expect(commands.filter((cmd) => cmd.Select === 'COUNT')).toHaveLength(0);
    expect(commands.filter((cmd) => cmd.__type === 'UpdateItem')).toHaveLength(0);
  });

  // A duplicate cancels the whole transaction, so the count is not touched for
  // a row this import did not create.
  test('does not increment the count for an address that already exists', async () => {
    ddbSend.mockImplementation((cmd) => {
      if (cmd.__type !== 'TransactWrite') {
        return Promise.resolve({ Count: 0 });
      }
      return Promise.reject(Object.assign(new Error('exists'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }, { Code: 'None' }]
      }));
    });

    const result = await handler(importEvent(['already@example.com']));

    expect(result.imported).toBe(0);
    expect(result.existing).toBe(1);
  });

  // An unreachable consent store must never read as consent. The address fails
  // rather than being imported, and surfaces in the result so the operator can
  // retry it rather than silently mailing someone who opted out.
  test('fails the address when the consent store cannot be read', async () => {
    getSuppression.mockImplementation(async (tenantId, email) => {
      if (email === 'unknown@example.com') {
        throw new Error('DynamoDB down');
      }
      return null;
    });

    const result = await handler(importEvent(['good@example.com', 'unknown@example.com']));

    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.errors[0]).toMatch(/Could not read consent state for unknown@example\.com/);

    // Only the address whose consent state was known got written.
    const written = ddbSend.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd) => cmd.__type === 'TransactWrite')
      .map((cmd) => cmd.TransactItems[1].Put.Item.email);
    expect(written).toEqual(['good@example.com']);
  });
});
