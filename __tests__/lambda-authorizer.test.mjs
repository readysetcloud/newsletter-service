import { jest } from '@jest/globals';

// Mock aws-jwt-verify
const mockVerify = jest.fn();
jest.unstable_mockModule('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({ verify: mockVerify }))
  }
}));

// Mock AWS SDK
const mockSend = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  GetItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  unmarshall: jest.fn((item) => ({
    pk: item.pk.S,
    sk: item.sk.S,
    tenantId: item.tenantId?.S,
    role: item.role?.S,
    name: item.name?.S,
    company: item.company?.S
  }))
}));

const { handler } = await import('../functions/auth/lambda-authorizer.mjs');

describe('Lambda Authorizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USER_POOL_ID = 'test-user-pool-id';
    process.env.USER_POOL_CLIENT_ID = 'test-client-id';
    process.env.TABLE_NAME = 'test-table';
  });

  it('should prioritize JWT token over API key when both are present', async () => {
    const mockPayload = {
      sub: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
      'custom:tenant_id': 'token-tenant-123',
      'custom:role': 'user'
    };

    // Mock DynamoDB response
    mockSend.mockResolvedValue({
      Item: {
        pk: { S: 'user-123' },
        sk: { S: 'user' },
        tenantId: { S: 'ddb-tenant-456' },
        role: { S: 'tenant_admin' },
        name: { S: 'John Doe' },
        company: { S: 'Acme Corp' }
      }
    });

    mockVerify.mockResolvedValue(mockPayload);

    const event = {
      headers: {
        Authorization: 'Bearer valid-jwt-token',
        'x-api-key': 'ak_some-api-key' // Should be ignored
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/profile'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('user-123');
    expect(result.context.authType).toBe('jwt');
    expect(result.context.email).toBe('test@example.com');
    expect(mockVerify).toHaveBeenCalledWith('valid-jwt-token');
  });

  it('should allow access with valid token and DynamoDB lookup', async () => {
    const mockPayload = {
      sub: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
      'custom:tenant_id': 'token-tenant-123',
      'custom:role': 'user'
    };

    // Mock DynamoDB response
    mockSend.mockResolvedValue({
      Item: {
        pk: { S: 'user-123' },
        sk: { S: 'user' },
        tenantId: { S: 'ddb-tenant-456' },
        role: { S: 'tenant_admin' },
        name: { S: 'John Doe' },
        company: { S: 'Acme Corp' }
      }
    });

    mockVerify.mockResolvedValue(mockPayload);

    const event = {
      headers: {
        Authorization: 'Bearer valid-jwt-token'
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/profile'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('user-123');
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.policyDocument.Statement[0].Resource).toBe('arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/*/*');
    expect(result.context.userId).toBe('user-123');
    expect(result.context.email).toBe('test@example.com');
    expect(result.context.tenantId).toBe('ddb-tenant-456'); // DynamoDB takes precedence
    expect(result.context.role).toBe('tenant_admin'); // DynamoDB takes precedence
    expect(result.context.name).toBe('John Doe');
    expect(result.context.company).toBe('Acme Corp');
    expect(result.context.isTenantAdmin).toBe('true');
  });

  it('should fallback to API key when no JWT token provided', async () => {
    // Mock validateApiKey to return user context
    const mockValidateApiKey = jest.fn().mockResolvedValue({
      userId: 'user-789',
      tenantId: 'tenant-abc',
      keyId: 'key-def',
      authType: 'api_key'
    });

    // We need to mock the validateApiKey import
    jest.doMock('../functions/auth/validate-api-key.mjs', () => ({
      validateApiKey: mockValidateApiKey
    }));

    const event = {
      headers: {
        'x-api-key': 'ak_valid-api-key'
        // No Authorization header
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/profile'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('user-789');
    expect(result.context.authType).toBe('api_key');
    expect(result.context.keyId).toBe('key-def');
    expect(result.context.role).toBe('api_user');
    expect(result.context.email).toBe('null');
    expect(mockValidateApiKey).toHaveBeenCalledWith('ak_valid-api-key');
  });

  it('should fallback to token claims when user not found in DynamoDB', async () => {
    const mockPayload = {
      sub: 'user-456',
      email: 'test2@example.com',
      username: 'testuser2',
      'custom:tenant_id': 'token-tenant-789',
      'custom:role': 'user'
    };

    // Mock DynamoDB response - user not found
    mockSend.mockResolvedValue({});

    mockVerify.mockResolvedValue(mockPayload);

    const event = {
      headers: {
        Authorization: 'Bearer valid-jwt-token'
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/profile'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('user-456');
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.context.tenantId).toBe('token-tenant-789'); // Falls back to token
    expect(result.context.role).toBe('user'); // Falls back to token
    expect(result.context.name).toBeUndefined(); // No DynamoDB data
  });

  it('should allow access for admin user', async () => {
    const mockPayload = {
      sub: 'admin-123',
      email: 'admin@example.com',
      username: 'admin',
      'custom:role': 'admin'
    };

    mockVerify.mockResolvedValue(mockPayload);

    const event = {
      headers: {
        Authorization: 'Bearer admin-jwt-token'
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/profile'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('admin-123');
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.context.userId).toBe('admin-123');
    expect(result.context.role).toBe('admin');
    expect(result.context.isAdmin).toBe('true');
    expect(result.context.tenantId).toBe('null'); // No tenant for admin
  });

  it('should deny access with invalid token', async () => {
    mockVerify.mockRejectedValue(new Error('Invalid token'));

    const event = {
      headers: {
        Authorization: 'Bearer invalid-jwt-token'
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/profile'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('user');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(result.context).toBeUndefined();
  });

  it('should deny access with no token', async () => {
    const event = {
      headers: {},
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/profile'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('user');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('should handle lowercase authorization header', async () => {
    const mockPayload = {
      sub: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
      'custom:role': 'user'
    };

    mockVerify.mockResolvedValue(mockPayload);

    const event = {
      headers: {
        authorization: 'Bearer valid-jwt-token' // lowercase
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/profile'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('user-123');
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(mockVerify).toHaveBeenCalledWith('valid-jwt-token');
  });

  it('should handle tenant admin role', async () => {
    const mockPayload = {
      sub: 'tenant-admin-123',
      email: 'tenant-admin@example.com',
      username: 'tenantadmin',
      'custom:tenant_id': 'tenant-123',
      'custom:role': 'tenant_admin'
    };

    mockVerify.mockResolvedValue(mockPayload);

    const event = {
      headers: {
        Authorization: 'Bearer tenant-admin-jwt-token'
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/profile'
    };

    const result = await handler(event);

    expect(result.context.role).toBe('tenant_admin');
    expect(result.context.isAdmin).toBe('false');
    expect(result.context.isTenantAdmin).toBe('true');
    expect(result.context.tenantId).toBe('tenant-123');
  });
});
