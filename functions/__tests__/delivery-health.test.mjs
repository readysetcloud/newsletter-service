import { jest, test, expect, beforeEach } from '@jest/globals';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
const send = jest.fn();
const remove = jest.fn();
const increment = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send })),
  GetItemCommand: jest.fn(input => ({ type: 'get', ...input })),
  TransactWriteItemsCommand: jest.fn(input => ({ type: 'transaction', ...input }))
}));
jest.unstable_mockModule('../utils/subscriber.mjs', () => ({ removeSubscriberAndDecrement: remove }));
jest.unstable_mockModule('../utils/issue-attribution.mjs', () => ({ incrementIssueCounter: increment }));
const { nextDeliveryHealth, recordDeliveryOutcome } = await import('../utils/delivery-health.mjs');
const outcome = (number, kind = 'temporary') => ({ id: `message-${number}`, sentAt: `2026-10-${String(number).padStart(2, '0')}T12:00:00.000Z`, kind });
let stored;
beforeEach(() => {
  jest.clearAllMocks(); stored = undefined;
  remove.mockResolvedValue(true);
  send.mockImplementation(async command => {
    if (command.type === 'get') return stored ? { Item: marshall(stored) } : {};
    stored = unmarshall(command.TransactItems[0].Put.Item);
    return {};
  });
});
test('suppresses only after three distinct temporary failures; duplicates do not advance', () => {
  let state = nextDeliveryHealth({}, outcome(1));
  state = nextDeliveryHealth(state, outcome(1));
  expect(state.consecutiveSoftBounces).toBe(1);
  expect(state.suppressionReason).toBeUndefined();
  state = nextDeliveryHealth(state, outcome(2));
  expect(state.suppressionReason).toBeUndefined();
  state = nextDeliveryHealth(state, outcome(3));
  expect(state.suppressionReason).toBe('repeated-soft-bounce');
});
test('a successful newer send resets the streak; delayed older failures do not undo it', () => {
  let state = nextDeliveryHealth({}, outcome(4, 'delivery'));
  for (const n of [3, 1, 2]) state = nextDeliveryHealth(state, outcome(n));
  expect(state.consecutiveSoftBounces).toBe(0);
  expect(state.suppressionReason).toBeUndefined();
  state = nextDeliveryHealth(state, outcome(5));
  expect(state.consecutiveSoftBounces).toBe(1);
});
test.each(['permanent', 'suppressed'])('%s failures suppress immediately, and later delivery never clears suppression', kind => {
  let state = nextDeliveryHealth({}, outcome(1, kind));
  expect(state.suppressionReason).toBeTruthy();
  state = nextDeliveryHealth(state, outcome(2, 'delivery'));
  expect(state.suppressionReason).toBeTruthy();
});
test('unknown failures do not masquerade as hard or temporary bounces', () => {
  expect(nextDeliveryHealth({}, outcome(1, 'unknown'))).toMatchObject({ consecutiveSoftBounces: 0 });
  expect(nextDeliveryHealth({}, outcome(1, 'unknown')).suppressionReason).toBeUndefined();
});
test('the history is bounded and old replays cannot grow the streak', () => {
  let state = {};
  for (let n = 1; n <= 60; n++) state = nextDeliveryHealth(state, { id: `${n}`, sentAt: new Date(n * 1000).toISOString(), kind: 'delivery' });
  expect(state.history).toHaveLength(50);
  expect(nextDeliveryHealth(state, { id: '1', sentAt: new Date(1000).toISOString(), kind: 'temporary' }).consecutiveSoftBounces).toBe(0);
});
test('suppression and health dedup commit together before subscriber removal', async () => {
  await recordDeliveryOutcome('tenant', 'Reader@Example.com', outcome(1, 'permanent'));
  const transaction = send.mock.calls.find(([command]) => command.type === 'transaction')[0];
  expect(transaction.TransactItems).toHaveLength(2);
  expect(unmarshall(transaction.TransactItems[1].Update.Key)).toEqual({ pk: 'tenant', sk: 'suppression#reader@example.com' });
  expect(transaction.TransactItems[1].Update.UpdateExpression).toContain('verified = if_not_exists(verified, :false)');
  expect(remove).toHaveBeenCalledWith('tenant', 'reader@example.com');
  expect(send.mock.invocationCallOrder.at(-1)).toBeLessThan(remove.mock.invocationCallOrder[0]);
});
test('removal failure retries without incrementing the streak or losing suppression', async () => {
  remove.mockRejectedValueOnce(new Error('delete unavailable'));
  await expect(recordDeliveryOutcome('tenant', 'a@example.com', outcome(1, 'permanent'))).rejects.toThrow('delete unavailable');
  await recordDeliveryOutcome('tenant', 'a@example.com', outcome(1, 'permanent'));
  expect(stored.history).toHaveLength(1);
  expect(stored.suppressionReason).toBe('hard-bounce');
  expect(send.mock.calls.filter(([command]) => command.type === 'transaction')).toHaveLength(1);
  expect(remove).toHaveBeenCalledTimes(2);
});
test('failed suppression transaction must not delete anyone', async () => {
  send.mockImplementation(async command => {
    if (command.type === 'get') return {};
    throw new Error('DynamoDB unavailable');
  });
  await expect(recordDeliveryOutcome('tenant', 'a@example.com', outcome(1, 'permanent'))).rejects.toThrow();
  expect(remove).not.toHaveBeenCalled();
});
test('attributes an actual removal to its originating issue only once', async () => {
  const failure = { ...outcome(1, 'permanent'), issuePk: 'tenant#238' };
  remove.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await recordDeliveryOutcome('tenant', 'a@example.com', failure);
  await recordDeliveryOutcome('tenant', 'a@example.com', failure);
  expect(increment).toHaveBeenCalledTimes(1);
  expect(increment).toHaveBeenCalledWith('tenant#238', 'cleaned');
});
test('concurrent health changes are reread and merged', async () => {
  let conflict = true;
  send.mockImplementation(async command => {
    if (command.type === 'get') return stored ? { Item: marshall(stored) } : {};
    if (conflict) {
      conflict = false;
      stored = { history: [outcome(1)], revision: 1 };
      throw Object.assign(new Error(), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
    }
    stored = unmarshall(command.TransactItems[0].Put.Item);
    return {};
  });
  await recordDeliveryOutcome('tenant', 'a@example.com', outcome(2));
  expect(stored.history).toHaveLength(2);
  expect(stored.revision).toBe(2);
});
