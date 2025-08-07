import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockSend })),
  AdminGetUserCommand: jest.fn((params) => params),
  ListUsersCommand: jest.fn((params) => params)
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
const { handler } = await import('../functions/admin/get-profile.mjs');

describe('Get Profile Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USER_POOL_ID = 'us-east-1_testpool123';
  });

  describe('GET /me (own profile)', () => {
    it('should successfully retrieve complete own profile', async () => {
      mockSend.mockResolvedValue({
        UserAttributes: [
          { Name: 'email', Value: 'test@example.com' },
          { Name: 'preferred_username', Value: 'testuser' },
          { Name: 'custom:brand_name', Value: 'Tech Weekly' },
          { Name: 'website', Value: 'https://techweekly.com' },
          { Name: 'custom:industry', Value: 'Technology' },
          { Name: 'custom:brand_description', Value: 'Weekly tech newsletter' },
          { Name: 'custom:brand_logo', Value: 'https://example.com/logo.png' },
          { Name: 'custom:brand_tags', Value: '["tech", "newsletter", "weekly"]' },
          { Name: 'given_name', Value: 'John' },
          { Name: 'family_name', Value: 'Doe' },
          { Name: 'custom:job_title', Value: 'Developer' },
          { Name: 'phone_number', Value: '+1234567890' },
          { Name: 'custom:profile_links', Value: '[{"name": "GitHub", "url": "https://github.com/johndoe"}, {"name": "LinkedIn", "url": "https://linkedin.com/in/johndoe"}]' },
          { Name: 'zoneinfo', Value: 'America/New_York' },
          { Name: 'locale', Value: 'en-US' },
          { Name: 'custom:profile_updated_at', Value: '2024-01-01T00:00:00Z' },
          { Name: 'custom:brand_updated_at', Value: '2024-01-02T00:00:00Z' }
        ],
        UserLastModifiedDate: new Date('2024-01-01T00:00:00Z')
      });

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
        }
        // No pathParameters - this is GET /me
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const profile = JSON.parse(result.body);

      // Should include all data including sensitive info
      expect(profile.userId).toBe('test-user-id');
      expect(profile.email).toBe('test@example.com');
      expect(profile.username).toBe('testuser');
      expect(profile.brand.tags).toEqual(['tech', 'newsletter', 'weekly']);
      expect(profile.profile.phoneNumber).toBe('+1234567890'); // Sensitive - included for own profile
      expect(profile.profile.links).toEqual([
        { name: 'GitHub', url: 'https://github.com/johndoe' },
        { name: 'LinkedIn', url: 'https://linkedin.com/in/johndoe' }
      ]);
      expect(profile.preferences.timezone).toBe('America/New_York'); // Sensitive - included for own profile
      expect(profile.preferences.locale).toBe('en-US'); // Sensitive - included for own profile
      expect(profile.profileUpdatedAt).toBe('2024-01-01T00:00:00Z'); // Internal metadata - included for own profile
      expect(profile.brandUpdatedAt).toBe('2024-01-02T00:00:00Z'); // Internal metadata - included for own profile
    });

    it('should handle missing optional attributes gracefully', async () => {
      mockSend.mockResolvedValue({
        UserAttributes: [
          { Name: 'email', Value: 'test@example.com' }
        ],
        UserLastModifiedDate: new Date('2024-01-01T00:00:00Z')
      });

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
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const profile = JSON.parse(result.body);

      // All optional fields should be null
      expect(profile.username).toBeNull();
      expect(profile.brand.brandName).toBeNull();
      expect(profile.brand.tags).toBeNull();
      expect(profile.profile.firstName).toBeNull();
      expect(profile.profile.links).toBeNull();
      expect(profile.preferences.timezone).toBeNull();
    });

    it('should handle invalid JSON in tags and links gracefully', async () => {
      mockSend.mockResolvedValue({
        UserAttributes: [
          { Name: 'email', Value: 'test@example.com' },
          { Name: 'custom:brand_tags', Value: 'invalid-json' },
          { Name: 'custom:profile_links', Value: 'also-invalid-json' }
        ],
        UserLastModifiedDate: new Date('2024-01-01T00:00:00Z')
      });

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
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const profile = JSON.parse(result.body);

      // Invalid JSON should result in null values
      expect(profile.brand.tags).toBeNull();
      expect(profile.profile.links).toBeNull();
    });
  });

  describe('GET /profiles/{username} (public profile)', () => {
    it('should successfully retrieve public profile for another user', async () => {
      // Mock ListUsers to find the user by username
      mockSend
        .mockResolvedValueOnce({
          Users: [{
            Attributes: [
              { Name: 'email', Value: 'otheruser@example.com' }
            ]
          }]
        })
        // Mock AdminGetUser to get the user's full profile
        .mockResolvedValueOnce({
          UserAttributes: [
            { Name: 'email', Value: 'otheruser@example.com' },
            { Name: 'preferred_username', Value: 'otheruser' },
            { Name: 'custom:brand_name', Value: 'Other Brand' },
            { Name: 'website', Value: 'https://otherbrand.com' },
            { Name: 'custom:brand_tags', Value: '["design", "creative"]' },
            { Name: 'given_name', Value: 'Jane' },
            { Name: 'family_name', Value: 'Smith' },
            { Name: 'custom:job_title', Value: 'Designer' },
            { Name: 'custom:profile_links', Value: '[{"name": "Portfolio", "url": "https://janesmith.design"}]' },
            { Name: 'phone_number', Value: '+0987654321' }, // Should be excluded from public profile
            { Name: 'zoneinfo', Value: 'Europe/London' }, // Should be excluded from public profile
            { Name: 'locale', Value: 'en-GB' }, // Should be excluded from public profile
            { Name: 'custom:profile_updated_at', Value: '2024-01-01T00:00:00Z' } // Should be excluded from public profile
          ],
          UserLastModifiedDate: new Date('2024-01-01T00:00:00Z')
        });

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
        pathParameters: {
          username: 'otheruser'
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const profile = JSON.parse(result.body);

      // Should include public data only
      expect(profile.username).toBe('otheruser');
      expect(profile.brand.brandName).toBe('Other Brand');
      expect(profile.brand.tags).toEqual(['design', 'creative']);
      expect(profile.profile.firstName).toBe('Jane');
      expect(profile.profile.jobTitle).toBe('Designer');
      expect(profile.profile.links).toEqual([{ name: 'Portfolio', url: 'https://janesmith.design' }]);
      expect(profile.lastModified).toBeDefined(); // Public metadata

      // Should NOT include sensitive information
      expect(profile.userId).toBeUndefined();
      expect(profile.email).toBeUndefined();
      expect(profile.profile.phoneNumber).toBeUndefined(); // Sensitive - excluded from public profile
      expect(profile.preferences).toBeUndefined(); // Sensitive - excluded from public profile
      expect(profile.profileUpdatedAt).toBeUndefined(); // Internal metadata - excluded from public profile
      expect(profile.brandUpdatedAt).toBeUndefined(); // Internal metadata - excluded from public profile
    });

    it('should return 404 for non-existent username', async () => {
      // Mock ListUsers to return no results
      mockSend.mockResolvedValueOnce({
        Users: []
      });

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
        pathParameters: {
          username: 'nonexistent'
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(mockSend).toHaveBeenCalledTimes(1); // Only ListUsers, not AdminGetUser
    });
  });

  it('should handle authentication errors', async () => {
    const event = {
      // No requestContext - should trigger auth error
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
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
  });
});
