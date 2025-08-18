import { jest } from '@jest/globals';

// Mock crypto
jest.unstable_mockModule('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn(() => ({
      digest: jest.fn(() => 'mock-hashed-key')
    }))
  }))
}));

const { decodeApiKey, hashApiKey } = await import('../functions/auth/decode-api-key.mjs');

describe('Decode API Key', () => {
  it('should decode valid API key successfully', () => {
    // Create a test API key with known payload
    const payload = {
      t: 'tenant-123',
      k: 'key-456',
      ts: 1640995200000 // 2022-01-01T00:00:00Z
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const encodedSecret = Buffer.from('test-secret').toString('base64url');
    const apiKey = `ak_${encodedPayload}.${encodedSecret}`;

    const result = decodeApiKey(apiKey);

    expect(result).toEqual({
      tenantId: 'tenant-123',
      keyId: 'key-456',
      timestamp: 1640995200000,
      secret: encodedSecret,
      fullKey: apiKey
    });
  });

  it('should return null for invalid API key format', () => {
    expect(decodeApiKey('invalid-key')).toBeNull();
    expect(decodeApiKey('ak_invalid')).toBeNull();
    expect(decodeApiKey('ak_invalid.format.extra')).toBeNull();
  });

  it('should return null for malformed payload', () => {
    const invalidPayload = Buffer.from('invalid-json').toString('base64url');
    const encodedSecret = Buffer.from('test-secret').toString('base64url');
    const apiKey = `ak_${invalidPayload}.${encodedSecret}`;

    const result = decodeApiKey(apiKey);
    expect(result).toBeNull();
  });

  it('should return null for incomplete payload', () => {
    const incompletePayload = {
      t: 'tenant-123',
      // missing k and ts
    };

    const encodedPayload = Buffer.from(JSON.stringify(incompletePayload)).toString('base64url');
    const encodedSecret = Buffer.from('test-secret').toString('base64url');
    const apiKey = `ak_${encodedPayload}.${encodedSecret}`;

    const result = decodeApiKey(apiKey);
    expect(result).toBeNull();
  });

  it('should return null for null/undefined input', () => {
    expect(decodeApiKey(null)).toBeNull();
    expect(decodeApiKey(undefined)).toBeNull();
    expect(decodeApiKey('')).toBeNull();
  });

  it('should hash API key correctly', () => {
    const result = hashApiKey('test-api-key');
    expect(result).toBe('mock-hashed-key');
  });
});
