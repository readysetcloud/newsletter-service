import { jest } from '@jest/globals';
import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
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
      expect(cmd).toBeInstanceOf(PutItemCommand);
      const item = unmarshall(cmd.input.Item);
      expect(item.pk).toBe('tenant1');
      expect(item.sk).toBe('suppression#person@example.com');
      expect(item.email).toBe('person@example.com');
      expect(item.method).toBe('one-click');
      expect(item.ipAddress).toBe('10.0.0.1');
      expect(typeof item.unsubscribedAt).toBe('string');
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
