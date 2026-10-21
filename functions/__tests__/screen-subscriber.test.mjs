import { jest, test, expect, beforeEach } from '@jest/globals';
const send = jest.fn();
const sesSend = jest.fn();
const screen = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send })),
  GetItemCommand: jest.fn(input => ({ type: 'get', ...input })),
  UpdateItemCommand: jest.fn(input => ({ type: 'update', ...input }))
}));
jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn(() => ({ send: sesSend })), GetSuppressedDestinationCommand: jest.fn(input => input)
}));
jest.unstable_mockModule('../utils/screening-decider.mjs', () => ({ decideSubscriber: jest.fn() }));
jest.unstable_mockModule('../utils/subscriber-screening.mjs', () => ({ screenSubscriber: screen, checkMailDomain: jest.fn(async () => 'valid') }));
const { marshall } = await import('@aws-sdk/util-dynamodb');
const { handler } = await import('../subscribers/screen-subscriber.mjs');
const subscriber = { tenantId: 'tenant', email: 'reader@example.com', addedAt: '2026-10-19', screening: { action: 'pending' } };
const event = { Records: [{ eventID: 'event', dynamodb: { NewImage: marshall(subscriber), SequenceNumber: '123' } }] };
beforeEach(() => {
  jest.clearAllMocks();
  send.mockImplementation(async command => command.type === 'get' ? { Item: marshall(subscriber) } : {});
  sesSend.mockRejectedValue(Object.assign(new Error(), { name: 'NotFoundException' }));
  screen.mockResolvedValue({ action: 'allow', version: 1 });
});
test('commits assessment only for the same pending signup', async () => {
  expect(await handler(event)).toEqual({ batchItemFailures: [] });
  expect(send.mock.calls[1][0]).toMatchObject({
    type: 'update', ConditionExpression: 'addedAt = :addedAt AND screening.#action = :pending'
  });
});
test.each([undefined, { ...subscriber, addedAt: 'new-incarnation' }, { ...subscriber, screening: { action: 'reject' } }])('deleted, recreated and already classified rows are untouched', async item => {
  send.mockResolvedValue(item ? { Item: marshall(item) } : {});
  expect(await handler(event)).toEqual({ batchItemFailures: [] });
  expect(screen).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});
test('SES permission/outage errors retry without releasing pending mail', async () => {
  sesSend.mockRejectedValue(Object.assign(new Error(), { name: 'AccessDeniedException' }));
  expect(await handler(event)).toEqual({ batchItemFailures: [{ itemIdentifier: '123' }] });
  expect(screen).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});
