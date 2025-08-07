import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
const mockCognitoSend = jest.fn();
const mockDynamoSend = jest.fn();
const mockEventBridgeSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockCognitoSend })),
  AdminUpdateUserAttributesCommand: jest.fn((params) => params),
  AdminGetUserCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDynamoSend })),
  UpdateItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj)
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
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  }))
}));

const { handler } = await import('../functions/admin/update-brand.mjs');

describe('Update My Brand Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USER_POOL_ID = 'us-east-1_testpool123';
    process.env.TABLE_NAME = 'test-table';

    // Reset all mock implementations
    mockCognitoSend.mockResolvedValue({});
    mockDynamoSend.mockResolvedValue({});
    mockEventBridgeSend.mockResolvedValue({});
  });

  const createTestEvent = (body) => ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        userId: 'test-user-id',
        email: 'test@example.com'
      }
    }
  });

  it('should successfully update brand details', async () => {
    const { getUserContext } = await import('../functions/auth/get-user-context.mjs');

    getUserContext.mockReturnValue({
      userId: 'test-user-id',
      email: 'test@example.com',
      tenantId: 'test-tenant-id'
    });

    // Mock first time brand save check (no existing brand_updated_at attribute)
    mockCognitoSend
      .mockResolvedValueOnce({
        UserAttributes: [] // No existing brand_updated_at attribute
      })
      .mockResolvedValueOnce({}); // AdminUpdateUserAttributesCommand

    const event = createTestEvent({
      brandName: 'Tech Weekly',
      website: 'https://techweekly.com',
      industry: 'Technology',
      brandDescription: 'Weekly tech insights',
      brandLogo: 'https://techweekly.com/logo.png'
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockCognitoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        UserPoolId: 'us-east-1_testpool123',
        Username: 'test@example.com',
        UserAttributes: expect.arrayContaining([
          { Name: 'custom:brand_name', Value: 'Tech Weekly' },
          { Name: 'website', Value: 'https://techweekly.com' },
          { Name: 'custom:industry', Value: 'Technology' },
          { Name: 'custom:brand_description', Value: 'Weekly tech insights' },
          { Name: 'custom:brand_logo', Value: 'https://techweekly.com/logo.png' },
          expect.objectContaining({ Name: 'custom:brand_updated_at' })
        ])
      })
    );

    // Should also finalize tenant and trigger workflows for first time save
    expect(mockDynamoSend).toHaveBeenCalled();
    expect(mockEventBridgeSend).toHaveBeenCalled();
  });

  it('should validate website URL format', async () => {
    const { getUserContext } = await import('../functions/auth/get-user-context.mjs');

    getUserContext.mockReturnValue({
      userId: 'test-user-id',
      email: 'test@example.com',
      tenantId: 'test-tenant-id'
    });

    const event = createTestEvent({
      website: 'invalid-url'
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('should validate brand logo URL format', async () => {
    const { getUserContext } = await import('../functions/auth/get-user-context.mjs');

    getUserContext.mockReturnValue({
      userId: 'test-user-id',
      email: 'test@example.com',
      tenantId: 'test-tenant-id'
    });

    const event = createTestEvent({
      brandLogo: 'not-a-url'
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('should require at least one field', async () => {
    const { getUserContext } = await import('../functions/auth/get-user-context.mjs');

    getUserContext.mockReturnValue({
      userId: 'test-user-id',
      email: 'test@example.com',
      tenantId: 'test-tenant-id'
    });

    const event = createTestEvent({});

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('should return 403 for authentication error', async () => {
    const { getUserContext } = await import('../functions/auth/get-user-context.mjs');

    getUserContext.mockImplementation(() => {
      throw new Error('Invalid authorization context');
    });

    const event = createTestEvent({ brandName: 'Test' });

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('should handle subsequent brand updates (not first time)', async () => {
    const { getUserContext } = await import('../functions/auth/get-user-context.mjs');

    getUserContext.mockReturnValue({
      userId: 'test-user-id',
      email: 'test@example.com',
      tenantId: 'test-tenant-id'
    });

    // Mock existing brand_updated_at attribute (not first time)
    mockCognitoSend
      .mockResolvedValueOnce({
        UserAttributes: [
          { Name: 'custom:brand_updated_at', Value: '2023-01-01T00:00:00.000Z' }
        ]
      })
      .mockResolvedValueOnce({}); // AdminUpdateUserAttributesCommand

    const event = createTestEvent({
      brandName: 'Updated Brand Name'
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockCognitoSend).toHaveBeenCalledTimes(2); // AdminGetUser + AdminUpdateUserAttributes
    expect(mockDynamoSend).not.toHaveBeenCalled(); // Should not finalize tenant
    expect(mockEventBridgeSend).not.toHaveBeenCalled(); // Should not trigger workflows
  });

  it('should handle tags validation', async () => {
    const { getUserContext } = await import('../functions/auth/get-user-context.mjs');

    getUserContext.mockReturnValue({
      userId: 'test-user-id',
      email: 'test@example.com',
      tenantId: 'test-tenant-id'
    });

    const event = createTestEvent({
      tags: ['tech', 'newsletter', 'weekly']
    });

    // Mock first time save
    mockCognitoSend
      .mockResolvedValueOnce({ UserAttributes: [] })
      .mockResolvedValueOnce({});

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockCognitoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        UserAttributes: expect.arrayContaining([
          { Name: 'custom:brand_tags', Value: JSON.stringify(['tech', 'newsletter', 'weekly']) }
        ])
      })
    );
  });
});
