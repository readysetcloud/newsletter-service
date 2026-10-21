import { jest, test, expect, beforeEach } from '@jest/globals';
import { marshall } from '@aws-sdk/util-dynamodb';
import { readFileSync } from 'node:fs';

const screen = jest.fn();
const welcome = jest.fn();
jest.unstable_mockModule('../subscribers/screen-subscriber.mjs', () => ({ handler: screen }));
jest.unstable_mockModule('../subscribers/send-welcome-email.mjs', () => ({ handler: welcome }));
const { handler } = await import('../subscribers/subscriber-stream.mjs');
const record = (eventName, before, after, sequence = '123') => ({ eventName, eventID: sequence,
  dynamodb: { OldImage: marshall(before), NewImage: marshall(after), SequenceNumber: sequence } });
const subscriber = action => ({ tenantId: 'tenant', email: 'reader@example.com', screening: { action } });
beforeEach(() => {
  jest.resetAllMocks();
  screen.mockResolvedValue({ batchItemFailures: [] });
  welcome.mockResolvedValue();
});

test('screens a pending insert, then welcomes only its persisted eligible transition', async () => {
  const inserted = record('INSERT', {}, subscriber('pending'));
  const modified = record('MODIFY', subscriber('pending'), subscriber('allow'), '124');
  expect(await handler({ Records: [inserted] })).toEqual({ batchItemFailures: [] });
  expect(screen).toHaveBeenCalledWith({ Records: [inserted] });
  expect(welcome).not.toHaveBeenCalled();
  expect(await handler({ Records: [modified] })).toEqual({ batchItemFailures: [] });
  expect(welcome).toHaveBeenCalledWith({ Records: [modified] });
});

test('watch gets welcome; rejects and unrelated updates do not', async () => {
  const watched = record('MODIFY', subscriber('pending'), subscriber('watch'));
  await handler({ Records: [watched,
    record('MODIFY', subscriber('pending'), subscriber('reject')),
    record('MODIFY', subscriber('allow'), subscriber('allow')),
    record('INSERT', {}, subscriber('allow')),
    record('REMOVE', subscriber('allow'), {})] });
  expect(welcome).toHaveBeenCalledTimes(1);
  expect(welcome).toHaveBeenCalledWith({ Records: [watched] });
  expect(screen).not.toHaveBeenCalled();
});

test('screening failures retain their checkpoint and stop later processing', async () => {
  screen.mockResolvedValue({ batchItemFailures: [{ itemIdentifier: '123' }] });
  const result = await handler({ Records: [record('INSERT', {}, subscriber('pending')),
    record('MODIFY', subscriber('pending'), subscriber('allow'), '124')] });
  expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: '123' }] });
  expect(welcome).not.toHaveBeenCalled();
});

test('a welcome failure retries that transition without repeating an earlier screening record', async () => {
  welcome.mockRejectedValueOnce(new Error('EventBridge unavailable'));
  const transition = record('MODIFY', subscriber('pending'), subscriber('allow'), '124');
  expect(await handler({ Records: [record('INSERT', {}, subscriber('pending')), transition] }))
    .toEqual({ batchItemFailures: [{ itemIdentifier: '124' }] });
  expect(await handler({ Records: [transition] })).toEqual({ batchItemFailures: [] });
  expect(screen).toHaveBeenCalledTimes(1);
  expect(welcome).toHaveBeenCalledTimes(2);
});

test('IaC keeps two Subscribers shard readers and replays lifecycle events from the trim horizon', () => {
  const template = readFileSync(new URL('../../template.yaml', import.meta.url), 'utf8');
  expect(template.match(/Stream: !GetAtt SubscribersTable.StreamArn/g)).toHaveLength(2);
  const resource = template.split('  SendWelcomeEmailFunction:')[1].split(/\n  [A-Za-z][A-Za-z0-9]*:/)[0];
  expect(resource).toContain('Handler: subscribers/subscriber-stream.handler');
  expect(resource).toContain('StartingPosition: TRIM_HORIZON');
  expect(resource).toContain('ReportBatchItemFailures');
  const filters = [...resource.matchAll(/Pattern: '([^']+)'/g)].map(match => JSON.parse(match[1]));
  expect(filters).toHaveLength(2);
  expect(filters[0].eventName).toEqual(['INSERT']);
  expect(filters[1].eventName).toEqual(['MODIFY']);
});
