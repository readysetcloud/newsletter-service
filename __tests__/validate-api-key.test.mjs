import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  GetItemCommand: jest.fn((params) => params),
  UpdateItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

// Mock decode-api-key
jest.unstable_mockModule('../functions/auth/decode-api-key.mjs', () => ({
  decodeApiKey: jest.fn(),
  hashApiKey: jest.fn(() => 'mock-hashed-key')
}));

const { validateApiKey } = await import('../functions/auth/validate-api-key.mjs');

describe('Validate API Key', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
  });

  it('should validate active API key successfully', async () => {
    const { decodeApiKey } = await import('../functions/auth/decode-api-key.mjs');

    decodeApiKey.mockReturnValue({
      tenantId: 'tenant-789',
      keyId: 'key-456'
    });

    mockSend
      .mockResolvedValueOnce({
        Item: {
          pk: 'tenant-789',
          sk: 'apikey#key-456',
          keyId: 'key-456',
          tenantId: 'tenant-789',
          createdBy: 'user-123',
          status: 'active',
          hashedKey: 'mock-hashed-key',
          expiresAt: null
        }
      })
      .mockResolvedValueOnce({}); // Update usage response

    const result = await validateApiKey('ak_valid-key-value');

    expect(result).toEqual({
      createdBy: 'user-123',
      tenantId: 'tenant-789',
      keyId: 'key-456',
      authType: 'api_key'
    });

    expect(mockSend).toHaveBeenCalledTimes(2); // GetItem + Update
  });

  it('should reject invalid API key format', async () => {
    const { decodeApiKey } = await import('../functions/auth/decode-api-key.mjs');

    decodeApiKey.mockReturnValue(null);

    const result = await validateApiKey('invalid-key-format');

    expect(result).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should reject non-existent API key', async () => {
    const { decodeApiKey } = await import('../functions/auth/decode-api-key.mjs');

    decodeApiKey.mockReturnValue({
      tenantId: 'tenant-789',
      keyId: 'non-existent'
    });

    mockSend.mockResolvedValue({}); // No Item returned

    const result = await validateApiKey('ak_non-existent-key');

    expect(result).toBeNull();
    expect(mockSend).toHaveBeenCalledTimes(1); // Only GetItem, no update
  });

  it('should reject inactive API key', async () => {
    const { decodeApiKey } = await import('../functions/auth/decode-api-key.mjs');

    decodeApiKey.mockReturnValue({
      tenantId: 'tenant-789',
      keyId: 'key-456'
    });

    mockSend.mockResolvedValue({
      Item: {
        pk: 'tenant-789',
        sk: 'apikey#key-456',
        keyId: 'key-456',
        tenantId: 'tenant-789',
        status: 'inactive',
        hashedKey: 'mock-hashed-key'
      }
    });

    const result = await validateApiKey('ak_inactive-key');

    expect(result).toBeNull();
    expect(mockSend).toHaveBeenCalledTimes(1); // Only GetItem, no update
  });

  it('should reject expired API key', async () => {
    const { decodeApiKey } = await import('../functions/auth/decode-api-key.mjs');
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // Yesterday

    decodeApiKey.mockReturnValue({
      tenantId: 'tenant-789',
      keyId: 'key-456'
    });

    mockSend.mockResolvedValue({
      Item: {
        pk: 'tenant-789',
        sk: 'apikey#key-456',
        keyId: 'key-456',
        tenantId: 'tenant-789',
        status: 'active',
        hashedKey: 'mock-hashed-key',
        expiresAt: pastDate
      }
    });

    const result = await validateApiKey('ak_expired-key');

    expect(result).toBeNull();
    expect(mockSend).toHaveBeenCalledTimes(1); // Only GetItem, no update
  });

  it('should handle API key without tenant', async () => {
    const { decodeApiKey } = await import('../functions/auth/decode-api-key.mjs');

    decodeApiKey.mockReturnValue({
      tenantId: null,
      keyId: 'key-456'
    });

    mockSend
      .mockResolvedValueOnce({
        Item: {
          pk: null,
          sk: 'apikey#key-456',
          keyId: 'key-456',
          tenantId: null,
          createdBy: 'user-123',
          status: 'active',
          hashedKey: 'mock-hashed-key'
        }
      })
      .mockResolvedValueOnce({});

    const result = await validateApiKey('ak_no-tenant-key');

    expect(result).toEqual({
      createdBy: 'user-123',
      tenantId: null,
      keyId: 'key-456',
      authType: 'api_key'
    });
  });

  it('should handle DynamoDB errors gracefully', async () => {
    mockSend.mockRejectedValue(new Error('DynamoDB error'));

    const result = await validateApiKey('ak_error-key');

    expect(result).toBeNull();
  });

  it('should handle usage update failures gracefully', async () => {
    const { decodeApiKey } = await import('../functions/auth/decode-api-key.mjs');

    decodeApiKey.mockReturnValue({
      tenantId: 'tenant-789',
      keyId: 'key-456'
    });

    mockSend
      .mockResolvedValueOnce({
        Item: {
          pk: 'tenant-789',
          sk: 'apikey#key-456',
          keyId: 'key-456',
          tenantId: 'tenant-789',
          createdBy: 'user-123',
          status: 'active',
          hashedKey: 'mock-hashed-key'
        }
      })
      .mockRejectedValueOnce(new Error('Update failed'));

    const result = await validateApiKey('ak_update-fail-key');

    // Should still return valid result even if usage update fails
    expect(result).toEqual({
      createdBy: 'user-123',
      tenantId: 'tenant-789',
      keyId: 'key-456',
      authType: 'api_key'
    });
  });
});
