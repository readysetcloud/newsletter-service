import { jest } fromest/globals';

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

// Mock auth helper
jest.unstable_mockModule('../functions/auth/get-user-context.mjs', () => ({
  getUserContext: jest.fn(),
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
    const { getUserContext } = await import('../functions/auth/get-user-context.mjs');

    getUserContext.mockReturnValue({
      userId: 'test-user-id',
      email: 'test@example.com',
      tenantId: 'test-tenant'
    });

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
        lastName: 'Doe'
      })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalled();
  });
});
