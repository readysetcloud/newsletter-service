import { jest } from '@jest/globals';
import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { recordSuppression, getSuppression, clearSuppression } from '../utils/suppression.mjs';

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

      const ok = await recordSuppression('tenant1', 'Person@Example.COM', 'one-click', {
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0'
      });

      expect(ok).toBe(true);
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

    // The removal itself must not fail because its paper trail could not be
    // written — the caller proceeds to delete regardless.
    test('never throws', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      await expect(recordSuppression('tenant1', 'a@b.com', 'complaint')).resolves.toBe(false);
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
    });

    test('returns null for an unsuppressed address', async () => {
      mockSend.mockResolvedValueOnce({});

      expect(await getSuppression('tenant1', 'a@b.com')).toBeNull();
    });

    // Fails open: "could not check" must not turn into "could not import".
    test('returns null on error rather than throwing', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      await expect(getSuppression('tenant1', 'a@b.com')).resolves.toBeNull();
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
