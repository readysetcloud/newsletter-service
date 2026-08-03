import { jest } from '@jest/globals';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
const { recordIssueEvent, issueNumberFromReference, ISSUE_EVENTS, TIMELINE_SK_PREFIX } =
  await import('../utils/issue-timeline.mjs');

describe('recordIssueEvent', () => {
  let mockSend;
  let originalEnv;

  const writtenItem = () => unmarshall(mockSend.mock.calls[0][0].input.Item);

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn(() => Promise.resolve({}));
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
    jest.restoreAllMocks();
  });

  test('writes the event under the issue partition, sorted by time', async () => {
    const landed = await recordIssueEvent({
      tenantId: 'readysetcloud',
      issueNumber: 227,
      type: ISSUE_EVENTS.SEND_DEFERRED,
      detail: { sendAt: '2026-08-03T14:00:00.000Z' }
    });

    expect(landed).toBe(true);

    const item = writtenItem();
    expect(item.pk).toBe('readysetcloud#227');
    expect(item.sk.startsWith(TIMELINE_SK_PREFIX)).toBe(true);
    expect(item.type).toBe('send_deferred');
    expect(item.detail).toEqual({ sendAt: '2026-08-03T14:00:00.000Z' });
    expect(item.actor).toBe('system');
    expect(typeof item.ttl).toBe('number');
  });

  test('records the caller when there is one', async () => {
    await recordIssueEvent({
      tenantId: 'readysetcloud',
      issueNumber: 227,
      type: ISSUE_EVENTS.RESEND_REQUESTED,
      actor: 'owner@example.com'
    });

    expect(writtenItem().actor).toBe('owner@example.com');
  });

  // Two events in the same millisecond are ordinary — a fan-out plans and then
  // emits — and a sort key without a tiebreaker would silently overwrite the
  // first with the second, which is a lost event on a page whose whole job is
  // to show that nothing is missing.
  test('gives two events in the same instant distinct sort keys', async () => {
    const at = '2026-08-03T14:00:00.000Z';

    await recordIssueEvent({ tenantId: 't', issueNumber: 1, type: 'a', at });
    await recordIssueEvent({ tenantId: 't', issueNumber: 1, type: 'b', at });

    const [first, second] = mockSend.mock.calls.map((call) => unmarshall(call[0].input.Item).sk);
    expect(first).not.toBe(second);
    expect(first.startsWith(`${TIMELINE_SK_PREFIX}${at}#`)).toBe(true);
  });

  test('omits an empty detail rather than storing an empty map', async () => {
    await recordIssueEvent({ tenantId: 't', issueNumber: 1, type: 'a', detail: {} });

    expect(writtenItem().detail).toBeUndefined();
  });

  // The whole reason this is best-effort: every caller is on a path where the
  // thing that just happened matters more than the note about it. Failing a
  // send because its own audit entry could not be written would be the worst
  // possible trade.
  test('never throws when the write fails', async () => {
    mockSend.mockRejectedValue(new Error('AccessDeniedException'));

    await expect(
      recordIssueEvent({ tenantId: 't', issueNumber: 1, type: 'a' })
    ).resolves.toBe(false);
  });

  test('refuses an event with no issue to attach it to', async () => {
    expect(await recordIssueEvent({ tenantId: 't', type: 'a' })).toBe(false);
    expect(await recordIssueEvent({ issueNumber: 1, type: 'a' })).toBe(false);
    expect(await recordIssueEvent({ tenantId: 't', issueNumber: 1 })).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  // Issue number 0 is not a real issue number, but `!issueNumber` would also
  // reject it, and a guard that drops valid input is worse than one that lets
  // an impossible value through to a write nobody will read.
  test('accepts issue number 0 rather than treating it as absent', async () => {
    expect(await recordIssueEvent({ tenantId: 't', issueNumber: 0, type: 'a' })).toBe(true);
  });
});

describe('issueNumberFromReference', () => {
  test('takes everything after the last underscore', () => {
    expect(issueNumberFromReference('readysetcloud_227')).toBe('227');
  });

  // Tenant ids can contain underscores, so splitting on the first one would
  // attribute the event to an issue number that does not exist.
  test('tolerates an underscore inside the tenant id', () => {
    expect(issueNumberFromReference('ready_set_cloud_227')).toBe('227');
  });

  test('returns null when there is nothing usable', () => {
    expect(issueNumberFromReference(undefined)).toBeNull();
    expect(issueNumberFromReference('')).toBeNull();
    expect(issueNumberFromReference('trailing_')).toBeNull();
  });
});
