import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockSend })),
  AdminUpdateUserAttributesCommand: jest.fn((params) => params)
}));

// Mock helpers
jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  formatResponse: jest.fn((statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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
const { handler } = await import('../functions/admin/update-profile.mjs');

describe('Update Profile Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USER_POOL_ID = 'us-east-1_testpool123';
  });

  it('should successfully update profile', async () => {
    mockSend.mockResolvedValue({});

    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({
        firstName: 'John',
        lastName: 'Doe',
        jobTitle: 'Developer',
        phoneNumber: '+1234567890',
        timezone: 'America/New_York',
        locale: 'en-US'
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        UserPoolId: 'us-east-1_testpool123',
        Username: 'test@example.com',
        UserAttributes: expect.arrayContaining([
          { Name: 'given_name', Value: 'John' },
          { Name: 'family_name', Value: 'Doe' },
          { Name: 'custom:job_title', Value: 'Developer' },
          { Name: 'phone_number', Value: '+1234567890' },
          { Name: 'zoneinfo', Value: 'America/New_York' },
          { Name: 'locale', Value: 'en-US' }
        ])
      })
    );
  });

  it('should validate phone number format', async () => {
    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({
        phoneNumber: 'invalid-phone'
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should validate locale format', async () => {
    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({
        locale: 'invalid-locale'
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should require at least one field', async () => {
    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({})
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should handle authentication errors', async () => {
    const event = {
      // No requestContext - should trigger auth error
      body: JSON.stringify({
        firstName: 'John'
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should handle Cognito errors gracefully', async () => {
    mockSend.mockRejectedValue(new Error('Cognito service error'));

    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({
        firstName: 'John'
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
  });

  it('should successfully update profile with links', async () => {
    mockSend.mockResolvedValue({});

    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({
        firstName: 'John',
        links: [
          { name: 'GitHub', url: 'https://github.com/johndoe' },
          { name: 'LinkedIn', url: 'https://linkedin.com/in/johndoe' }
        ]
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        UserPoolId: 'us-east-1_testpool123',
        Username: 'test@example.com',
        UserAttributes: expect.arrayContaining([
          { Name: 'given_name', Value: 'John' },
          { Name: 'custom:profile_links', Value: '[{"name":"GitHub","url":"https://github.com/johndoe"},{"name":"LinkedIn","url":"https://linkedin.com/in/johndoe"}]' }
        ])
      })
    );

    const body = JSON.parse(result.body);
    expect(body.profile.links).toEqual([
      { name: 'GitHub', url: 'https://github.com/johndoe' },
      { name: 'LinkedIn', url: 'https://linkedin.com/in/johndoe' }
    ]);
  });

  it('should validate links array structure', async () => {
    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({
        links: [
          { name: 'GitHub' } // Missing url
        ]
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should validate links array size limit', async () => {
    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({
        links: Array(11).fill({ name: 'Test', url: 'https://example.com' }) // Too many links
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should validate link URL format', async () => {
    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({
        links: [
          { name: 'Invalid', url: 'not-a-url' }
        ]
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should update only links when provided', async () => {
    mockSend.mockResolvedValue({});

    const event = {
      requestContext: {
        authorizer: {
          userId: 'test-user-id',
          email: 'test@example.com',
          tenantId: 'test-tenant',
          role: 'user',
          isAdmin: 'false',
          isTenantAdmin: 'false'
        }
      },
      body: JSON.stringify({
        links: [
          { name: 'Portfolio', url: 'https://johndoe.dev' }
        ]
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        UserPoolId: 'us-east-1_testpool123',
        Username: 'test@example.com',
        UserAttributes: expect.arrayContaining([
          { Name: 'custom:profile_links', Value: '[{"name":"Portfolio","url":"https://johndoe.dev"}]' }
        ])
      })
    );
  });
});
