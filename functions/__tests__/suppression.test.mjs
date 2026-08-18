import { jest } from '@jest/globals';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand, DeleteItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { recordSuppression, getSuppression, clearSuppression, listSuppressedEmails } from '../utils/suppression.mjs';

describe('suppression', () => {
  let mockSend;

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  describe('recordSuppression', () => {
    test('writes the revocation under the tenant partition, lowercased', async () => {
      mockSend.mockResolvedValueOnce({});

      await recordSuppression('tenant1', 'Person@Example.COM', 'one-click', {
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0'
      });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(UpdateItemCommand);
      const key = unmarshall(cmd.input.Key);
      expect(key.pk).toBe('tenant1');
      expect(key.sk).toBe('suppression#person@example.com');

      const values = unmarshall(cmd.input.ExpressionAttributeValues);
      expect(values[':email']).toBe('person@example.com');
      expect(values[':method']).toBe('one-click');
      expect(values[':ipAddress']).toBe('10.0.0.1');
      expect(values[':userAgent']).toBe('Mozilla/5.0');
      expect(typeof values[':now']).toBe('string');
    });

    // The record's job is to answer "when was consent revoked?". A retry, a
    // complaint arriving after the person already used the footer link, or a
    // click on a months-old issue must not rewrite that answer — the first
    // revocation is the one that decides whether a send was allowed.
    test('never overwrites the original revocation instant or method', async () => {
      mockSend.mockResolvedValueOnce({});

      await recordSuppression('tenant1', 'a@b.com', 'complaint', {
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0'
      });

      const { UpdateExpression } = mockSend.mock.calls[0][0].input;

      expect(UpdateExpression).toContain('#unsubscribedAt = if_not_exists(#unsubscribedAt, :now)');
      expect(UpdateExpression).toContain('#method = if_not_exists(#method, :method)');
      expect(UpdateExpression).toContain('ipAddress = if_not_exists(ipAddress, :ipAddress)');
      expect(UpdateExpression).toContain('userAgent = if_not_exists(userAgent, :userAgent)');
    });

    // Operational history is still kept, just not in the fields that answer the
    // compliance question.
    test('tracks the latest signal separately from the first', async () => {
      mockSend.mockResolvedValueOnce({});

      await recordSuppression('tenant1', 'a@b.com', 'complaint', { ipAddress: '10.0.0.1' });

      const { UpdateExpression } = mockSend.mock.calls[0][0].input;

      expect(UpdateExpression).toContain('lastUnsubscribedAt = :now');
      expect(UpdateExpression).toContain('lastMethod = :method');
      expect(UpdateExpression).toContain('lastIpAddress = :ipAddress');
    });

    // Absent metadata must not put an undefined value into the expression.
    test('omits metadata clauses when there is no metadata', async () => {
      mockSend.mockResolvedValueOnce({});

      await recordSuppression('tenant1', 'a@b.com', 'one-click');

      const { UpdateExpression, ExpressionAttributeValues } = mockSend.mock.calls[0][0].input;

      expect(UpdateExpression).not.toContain('ipAddress');
      expect(UpdateExpression).not.toContain('userAgent');
      expect(Object.keys(ExpressionAttributeValues)).toEqual(
        expect.not.arrayContaining([':ipAddress', ':userAgent'])
      );
    });

    // Every suppression blocks mail. The flag exists so the confirmed
    // re-opt-in flow can tell which ones were never proof of ownership — a
    // typed address on the no-token form is a state anyone can impose on
    // someone else, and that fact has to be written down when the record is
    // made or it is gone.
    test.each([
      ['one-click', true],
      ['encrypted-link', true],
      ['complaint', true],
      ['manual-form', false]
    ])('marks a %s revocation verified=%s', async (method, expected) => {
      mockSend.mockResolvedValueOnce({});

      await recordSuppression('tenant1', 'a@b.com', method);

      const values = unmarshall(mockSend.mock.calls[0][0].input.ExpressionAttributeValues);
      expect(values[':verified']).toBe(expected);
    });

    // A verified revocation must not be downgraded by a later unverified one.
    test('does not overwrite the original verification status', async () => {
      mockSend.mockResolvedValueOnce({});

      await recordSuppression('tenant1', 'a@b.com', 'manual-form');

      const { UpdateExpression } = mockSend.mock.calls[0][0].input;
      expect(UpdateExpression).toContain('verified = if_not_exists(verified, :verified)');
      expect(UpdateExpression).toContain('lastVerified = :verified');
    });

    // Consent fails closed: reporting a durable unsubscribe that was never
    // recorded would leave the person exposed to the next list import, so the
    // caller has to hear about this and abort the removal.
    test('throws so the caller can abort the removal', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      await expect(recordSuppression('tenant1', 'a@b.com', 'complaint')).rejects.toThrow('DynamoDB down');
    });
  });

  describe('getSuppression', () => {
    test('returns the record for a suppressed address', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({
          pk: 'tenant1',
          sk: 'suppression#a@b.com',
          unsubscribedAt: '2026-08-01T00:00:00.000Z',
          method: 'encrypted-link'
        })
      });

      const record = await getSuppression('tenant1', 'A@B.com');

      expect(record.method).toBe('encrypted-link');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(GetItemCommand);
      expect(unmarshall(cmd.input.Key)).toEqual({ pk: 'tenant1', sk: 'suppression#a@b.com' });
      expect(cmd.input.ConsistentRead).toBe(true);
    });

    test('returns null for an unsuppressed address', async () => {
      mockSend.mockResolvedValueOnce({});

      expect(await getSuppression('tenant1', 'a@b.com')).toBeNull();
    });

    // "No suppression on record" and "could not check" are different facts.
    // Collapsing them into null let an unreachable consent store read as
    // consent, so a transient failure during an import would have
    // re-subscribed opted-out people.
    test('throws rather than reporting no suppression when it cannot read', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      await expect(getSuppression('tenant1', 'a@b.com')).rejects.toThrow('DynamoDB down');
    });
  });

  describe('listSuppressedEmails', () => {
    test('collects every suppressed address across pages, lowercased', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [marshall({ email: 'One@Example.com' })],
          LastEvaluatedKey: marshall({ pk: 'tenant1', sk: 'suppression#one@example.com' })
        })
        .mockResolvedValueOnce({ Items: [marshall({ email: 'two@example.com' })] });

      const suppressed = await listSuppressedEmails('tenant1');

      expect(suppressed).toEqual(new Set(['one@example.com', 'two@example.com']));
    });

    // The send-time filter is the last check before mail leaves, so a
    // suppression written moments earlier must not be briefly invisible to it.
    // Asserted here so this path and the single-address read cannot drift apart.
    test('reads strongly consistently, like the single-address lookup', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await listSuppressedEmails('tenant1');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(QueryCommand);
      expect(cmd.input.ConsistentRead).toBe(true);
    });

    test('throws rather than reporting an empty set when it cannot read', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      await expect(listSuppressedEmails('tenant1')).rejects.toThrow('DynamoDB down');
    });
  });

  describe('clearSuppression', () => {
    test('deletes the record and never throws', async () => {
      mockSend.mockResolvedValueOnce({});
      await clearSuppression('tenant1', 'A@B.com');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(DeleteItemCommand);
      expect(unmarshall(cmd.input.Key)).toEqual({ pk: 'tenant1', sk: 'suppression#a@b.com' });

      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));
      await expect(clearSuppression('tenant1', 'a@b.com')).resolves.toBeUndefined();
    });
  });
});
