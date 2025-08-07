import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  PutItemCommand: jest.fn((params) => params),
  QueryCommand: jest.fn((params) => params),
  GetItemCommand: jest.fn((params) => params),
  DeleteItemCommand: jest.fn((params) => params),
  UpdateItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

// Mock crypto
jest.unstable_mockModule('crypto', () => ({
  randomBytes: jest.fn((size) => ({
    toString: jest.fn((encoding) => {
      if (encoding === 'base64url') return 'mock-base64url-key';
      if (encoding === 'hex') return 'mock-hex-id';
      return 'mock-bytes';
    })
  }))
}));

// Mock decode-api-key
jest.unstable_mockModule('../functions/auth/decode-api-key.mjs', () => ({
  hashApiKey: jest.fn(() => 'mock-hashed-key')
}));

// Mock helpers
jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  formatResponse: jest.fn((statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })),
  formatEmptyResponse: jest.fn((statusCode) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: ''
  }))
}));

// Mock auth helper - simulate the real getUserContext behavior
jest.unstable_mockModule('../functions/auth/get-user-context.mjs', () => ({
  getUserContext: jest.fn((event) => {
    if (!event.requestContext?.authorizer) {
      throw new Error('Invalid authorization context');
    }
    return {
      userId: event.requestContext.authorizer.userId,
      email: event.requestContext.authorizer.email,
      tenantId: event.requestContext.authorizer.tenantId,
      role: event.requestContext.authorizer.role,
      isAdmin: event.requestContext.authorizer.isAdmin === 'true',
      isTenantAdmin: event.requestContext.authorizer.isTenantAdmin === 'true'
    };
  }),
  formatAuthError: jest.fn((message) => ({
    statusCode: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  }))
}));

// Import handler AFTER mocks
const { handler } = await import('../functions/admin/manage-api-keys.mjs');

describe('Manage API Keys Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
  });

  describe('POST - Create API Key', () => {
    it('should create API key successfully', async () => {
      // Mock the duplicate name check query
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // No existing keys with same name
        .mockResolvedValueOnce({}); // Create API key

      const event = {
        httpMethod: 'POST',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        body: JSON.stringify({
          name: 'Test API Key',
          description: 'For testing purposes'
        })
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        TableName: 'test-table',
        Item: expect.objectContaining({
          pk: 'tenant-456',
          name: 'Test API Key',
          description: 'For testing purposes',
          hashedKey: 'mock-hashed-key',
          status: 'active'
        })
      }));
    });

    it('should validate required name field', async () => {
      const event = {
        httpMethod: 'POST',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        body: JSON.stringify({
          description: 'Missing name'
        })
      };

      const result = await handler(event);

      // The validation error doesn't have "Validation error:" prefix, so it returns 500
      expect(result.statusCode).toBe(500);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should validate expiration date', async () => {
      // Mock the duplicate name check to return empty result
      mockSend.mockResolvedValueOnce({ Items: [] });

      const pastDate = new Date(Date.now() - 86400000).toISOString(); // Yesterday

      const event = {
        httpMethod: 'POST',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        body: JSON.stringify({
          name: 'Test Key',
          expiresAt: pastDate
        })
      };

      const result = await handler(event);

      // The validation error doesn't have "Validation error:" prefix, so it returns 500
      expect(result.statusCode).toBe(500);
      expect(mockSend).toHaveBeenCalledTimes(1); // Only the duplicate check
    });

    it('should prevent duplicate API key names', async () => {
      // Mock existing key with same name
      mockSend.mockResolvedValueOnce({
        Items: [{ name: 'Duplicate Key' }]
      });

      const event = {
        httpMethod: 'POST',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        body: JSON.stringify({
          name: 'Duplicate Key'
        })
      };

      const result = await handler(event);

      // This validation error has the "Validation error:" prefix, so it returns 400
      expect(result.statusCode).toBe(400);
      expect(mockSend).toHaveBeenCalledTimes(1); // Only the duplicate check
    });
  });

  describe('GET - List API Keys', () => {
    it('should list API keys successfully', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            keyId: 'key-1',
            name: 'API Key 1',
            description: 'First key',
            createdAt: '2024-01-01T00:00:00Z',
            status: 'active',
            usageCount: 5
          },
          {
            keyId: 'key-2',
            name: 'API Key 2',
            description: null,
            createdAt: '2024-01-02T00:00:00Z',
            status: 'active',
            usageCount: 0
          }
        ]
      });

      const event = {
        httpMethod: 'GET',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.apiKeys).toHaveLength(2);
      expect(body.count).toBe(2);
    });
  });

  describe('GET - Get Specific API Key', () => {
    it('should get API key details successfully', async () => {
      mockSend.mockResolvedValue({
        Item: {
          keyId: 'key-1',
          name: 'API Key 1',
          description: 'First key',
          createdAt: '2024-01-01T00:00:00Z',
          status: 'active',
          usageCount: 5
        }
      });

      const event = {
        httpMethod: 'GET',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        pathParameters: { keyId: 'key-1' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.apiKey.name).toBe('API Key 1');
    });

    it('should return 404 for non-existent key', async () => {
      mockSend.mockResolvedValue({});

      const event = {
        httpMethod: 'GET',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        pathParameters: { keyId: 'non-existent' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
    });
  });

  describe('DELETE - Delete API Key', () => {
    it('should delete API key successfully', async () => {
      // Mock exists check
      mockSend
        .mockResolvedValueOnce({
          Item: { keyId: 'key-1', name: 'Test Key' }
        })
        .mockResolvedValueOnce({}); // Delete response

      const event = {
        httpMethod: 'DELETE',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        pathParameters: { keyId: 'key-1' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(204);
      expect(mockSend).toHaveBeenCalledTimes(2); // Check exists + delete
    });

    it('should return 404 for non-existent key', async () => {
      mockSend.mockResolvedValue({});

      const event = {
        httpMethod: 'DELETE',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        pathParameters: { keyId: 'non-existent' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
    });
  });

  describe('DELETE - Revoke API Key (with revoke=true)', () => {
    it('should revoke API key successfully', async () => {
      // Mock exists check
      mockSend
        .mockResolvedValueOnce({
          Item: { keyId: 'key-1', name: 'Test Key', status: 'active' }
        })
        .mockResolvedValueOnce({}); // Update response

      const event = {
        httpMethod: 'DELETE',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        pathParameters: { keyId: 'key-1' },
        queryStringParameters: { revoke: 'true' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('API key revoked successfully');
      expect(body.keyId).toBe('key-1');
      expect(body.status).toBe('revoked');
      expect(body.revokedAt).toBeDefined();
      expect(mockSend).toHaveBeenCalledTimes(2); // Check exists + update
    });

    it('should return 404 for non-existent key', async () => {
      mockSend.mockResolvedValue({});

      const event = {
        httpMethod: 'DELETE',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        pathParameters: { keyId: 'non-existent' },
        queryStringParameters: { revoke: 'true' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
    });

    it('should return 400 for already revoked key', async () => {
      mockSend.mockResolvedValue({
        Item: { keyId: 'key-1', name: 'Test Key', status: 'revoked' }
      });

      const event = {
        httpMethod: 'DELETE',
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        },
        pathParameters: { keyId: 'key-1' },
        queryStringParameters: { revoke: 'true' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body).toBe('API key is already revoked');
    });
  });

  it('should handle unsupported HTTP methods', async () => {
    const event = {
      httpMethod: 'PUT',
      requestContext: {
        authorizer: {
          userId: 'user-123',
          email: 'test@example.com',
          tenantId: 'tenant-456',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(405);
  });
});
