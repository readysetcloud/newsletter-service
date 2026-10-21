import { jest, test, expect, beforeEach } from '@jest/globals';
import { marshall } from '@aws-sdk/util-dynamodb';
const send = jest.fn(), sesSend = jest.fn(), eventSend = jest.fn();
const suppress = jest.fn(), remove = jest.fn(), increment = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send })),
  QueryCommand: jest.fn(input => ({ type: 'query', ...input })), GetItemCommand: jest.fn(input => ({ type: 'get', ...input }))
}));
jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn(() => ({ send: sesSend })), ListSuppressedDestinationsCommand: jest.fn(input => input)
}));
jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: eventSend })), PutEventsCommand: jest.fn(input => input)
}));
jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  getTenant: jest.fn(async () => ({ email: 'admin@example.com' })),
  sendWithRetry: jest.fn(async fn => fn()),
  throttle: jest.fn(async tasks => { for (const task of tasks) await task(); })
}));
jest.unstable_mockModule('../functions/utils/subscriber.mjs', () => ({ removeSubscriberAndDecrement: remove }));
jest.unstable_mockModule('../functions/utils/suppression.mjs', () => ({ recordSuppression: suppress }));
jest.unstable_mockModule('../functions/utils/issue-attribution.mjs', () => ({
  getMostRecentPublishedIssue: jest.fn(async () => ({ pk: 'tenant#238' })), incrementIssueCounter: increment
}));
jest.unstable_mockModule('../functions/utils/subscriber-count.mjs', () => ({
  countSubscriberRows: jest.fn(async () => 100), reconcileSubscriberCount: jest.fn()
}));
const { handler } = await import('../functions/subscribers/clean-bounced-subscribers.mjs');
const event = { detail: { tenantId: { id: 'tenant' }, currentIssue: 'tenant#238', previousIssue: 'tenant#237' } };
const page = (...emails) => ({ Items: emails.map(email => marshall({ email })) });
beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUBSCRIBERS_TABLE_NAME = 'subscribers';
  send.mockImplementation(async command => command.type === 'get' ? { Item: marshall({ subscribers: 100 }) } : page('hard@example.com', 'soft@example.com', 'complaint@example.com', 'SEGMENT#one'));
  sesSend.mockResolvedValue({ SuppressedDestinationSummaries: [
    { EmailAddress: 'hard@example.com', Reason: 'BOUNCE' }, { EmailAddress: 'complaint@example.com', Reason: 'COMPLAINT' }
  ] });
  suppress.mockResolvedValue(); remove.mockResolvedValue(true); eventSend.mockResolvedValue({});
});
test('reconciles confirmed SES suppressions and leaves temporary failures alone', async () => {
  expect(await handler(event)).toEqual({ removed: 2 });
  expect(suppress.mock.calls).toEqual([
    ['tenant', 'hard@example.com', 'ses-bounce'], ['tenant', 'complaint@example.com', 'ses-complaint']
  ]);
  expect(remove.mock.calls.map(call => call[1])).toEqual(['hard@example.com', 'complaint@example.com']);
  expect(increment).not.toHaveBeenCalled();
  expect(eventSend).toHaveBeenCalledTimes(1);
});
test('durably suppresses before deleting', async () => {
  await handler(event);
  expect(suppress.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
});
test('pages both SES and the tenant subscriber partition', async () => {
  sesSend.mockReset().mockResolvedValueOnce({ SuppressedDestinationSummaries: [], NextToken: 'next' }).mockResolvedValueOnce({ SuppressedDestinationSummaries: [{ EmailAddress: 'hard@example.com', Reason: 'BOUNCE' }] });
  send.mockReset().mockResolvedValueOnce({ ...page('soft@example.com'), LastEvaluatedKey: { email: { S: 'soft@example.com' } } }).mockResolvedValueOnce(page('hard@example.com')).mockResolvedValueOnce({ Item: marshall({ subscribers: 100 }) });
  expect(await handler(event)).toEqual({ removed: 1 });
  expect(sesSend.mock.calls[1][0].NextToken).toBe('next');
  expect(send.mock.calls[1][0].ExclusiveStartKey).toEqual({ email: { S: 'soft@example.com' } });
  expect(send.mock.calls[0][0].TableName).toBe('subscribers');
});
test('an SES read failure aborts instead of treating it as an empty list', async () => {
  sesSend.mockRejectedValueOnce(new Error('SES unavailable'));
  await expect(handler(event)).rejects.toThrow('SES unavailable');
  expect(remove).not.toHaveBeenCalled();
});
test('a suppression write failure prevents deletion and causes retry', async () => {
  suppress.mockRejectedValueOnce(new Error('write unavailable'));
  await expect(handler(event)).rejects.toThrow('write unavailable');
  expect(remove).not.toHaveBeenCalled();
});
test('removal failures cause retry instead of successful cleanup', async () => {
  remove.mockRejectedValueOnce(new Error('delete unavailable'));
  await expect(handler(event)).rejects.toThrow('delete unavailable');
});
test('already absent records never decrement or attribute a second removal', async () => {
  remove.mockResolvedValue(false);
  expect(await handler(event)).toEqual({ removed: 0 });
  expect(increment).not.toHaveBeenCalled();
  expect(eventSend).not.toHaveBeenCalled();
});
test('two issue failures without SES suppression are insufficient to remove anyone', async () => {
  sesSend.mockResolvedValue({ SuppressedDestinationSummaries: [] });
  expect(await handler(event)).toEqual({ removed: 0 });
  expect(remove).not.toHaveBeenCalled();
});
