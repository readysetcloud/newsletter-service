import { jest } from '@jest/globals';
import crypto from 'crypto';
import { marshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');

process.env.TABLE_NAME = 'test-newsletter-table';

const { decodeApiKey, validateApiKey } = await import('../utils/api-key-validator.mjs');

const makeApiKey = (tenantId = 'tenant1', keyId = 'key1') => {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, k: keyId, ts: 1700000000 })).toString('base64url');
  return `ak_${payload}.supersecret`;
};

const hashKey = (apiKey) => crypto.createHash('sha256').update(apiKey).digest('hex');

describe('api-key-validator', () => {
  let mockDdbSend;

  beforeEach(() => {
    mockDdbSend = jest.fn();
    DynamoDBClient.prototype.send = mockDdbSend;
    jest.clearAllMocks();
  });

  describe('decodeApiKey', () => {
    test('decodes a well-formed key', () => {
      expect(decodeApiKey(makeApiKey('tenantA', 'keyB'))).toEqual({ tenantId: 'tenantA', keyId: 'keyB' });
    });

    test('rejects malformed keys', () => {
      const payload = Buffer.from(JSON.stringify({ t: 'tenant1', k: 'key1' })).toString('base64url');
      for (const bad of [
        undefined,
        null,
        '',
        'not-a-key',
        'ak_onlyonepart',
        `ak_${payload}.secret.extra`,
        'ak_!!!notbase64json.secret',
        `ak_${Buffer.from('{"k":"key1"}').toString('base64url')}.secret`
      ]) {
        expect(decodeApiKey(bad)).toBeNull();
      }
    });
  });

  describe('validateApiKey', () => {
    const apiKey = makeApiKey();
    const keyRecord = (overrides = {}) => ({
      Item: marshall({
        pk: 'tenant1',
        sk: 'apikey#key1',
        tenantId: 'tenant1',
        keyId: 'key1',
        hashedKey: hashKey(apiKey),
        status: 'active',
        ...overrides
      })
    });

    test('returns key context for a valid key', async () => {
      mockDdbSend.mockResolvedValue(keyRecord());

      const result = await validateApiKey(apiKey);

      expect(result).toEqual({ tenantId: 'tenant1', keyId: 'key1' });
      const getInput = mockDdbSend.mock.calls[0][0].input;
      expect(getInput.Key).toEqual(marshall({ pk: 'tenant1', sk: 'apikey#key1' }));
    });

    test('returns null when the key record does not exist', async () => {
      mockDdbSend.mockResolvedValue({});
      expect(await validateApiKey(apiKey)).toBeNull();
    });

    test('returns null on hash mismatch', async () => {
      mockDdbSend.mockResolvedValue(keyRecord({ hashedKey: hashKey('ak_tampered.key') }));
      expect(await validateApiKey(apiKey)).toBeNull();
    });

    test('returns null for inactive keys', async () => {
      mockDdbSend.mockResolvedValue(keyRecord({ status: 'revoked' }));
      expect(await validateApiKey(apiKey)).toBeNull();
    });

    test('returns null for expired keys', async () => {
      mockDdbSend.mockResolvedValue(keyRecord({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
      expect(await validateApiKey(apiKey)).toBeNull();
    });

    test('accepts keys with a future expiry', async () => {
      mockDdbSend.mockResolvedValue(keyRecord({ expiresAt: new Date(Date.now() + 86400000).toISOString() }));
      expect(await validateApiKey(apiKey)).toEqual({ tenantId: 'tenant1', keyId: 'key1' });
    });

    test('returns null for undecodable keys without hitting DynamoDB', async () => {
      expect(await validateApiKey('garbage')).toBeNull();
      expect(mockDdbSend).not.toHaveBeenCalled();
    });
  });
});
