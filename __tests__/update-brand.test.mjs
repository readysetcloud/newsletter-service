import { jest } from '@jest/globals';

// ---- Mocks ----
const mockCognitoSend = jest.fn();
const mockDynamoSend = jest.fn();
const mockEventBridgeSend = jest.fn();
const mockPublishBrandEvent = jest.fn();

// Cognito
jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockCognitoSend })),
  AdminUpdateUserAttributesCommand: jest.fn((params) => ({ __type: 'AdminUpdateUserAttributes', ...params })),
}));

// DynamoDB
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDynamoSend })),
  UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
  GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
  PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
}));

// EventBridge
jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params })),
}));

// util-dynamodb
jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  // Keep it simple: pass-through so we can inspect values easily
  marshall: (obj) => obj,
  // Return input as-is; our tests will feed plain objects for readability
  unmarshall: (attr) => attr,
}));

// helpers
const mockFormatEmptyResponse = jest.fn((code) => ({ statusCode: code, body: '' }));
const mockFormatResponse = jest.fn((code, msg) => ({ statusCode: code, body: JSON.stringify(msg) }));

jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  formatEmptyResponse: mockFormatEmptyResponse,
  formatResponse: mockFormatResponse,
}));

// auth context
const mockGetUserContext = jest.fn();
const mockFormatAuthError = jest.fn((message) => ({
  statusCode: 401,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message }),
}));

jest.unstable_mockModule('../functions/auth/get-user-context.mjs', () => ({
  getUserContext: mockGetUserContext,
  formatAuthError: mockFormatAuthError,
}));

// brand event publisher
jest.unstable_mockModule('../functions/utils/event-publisher.mjs', () => ({
  publishBrandEvent: mockPublishBrandEvent,
  EVENT_TYPES: { BRAND_UPDATED: 'BRAND_UPDATED' },
}));

// Import AFTER mocks
const { handler } = await import('../functions/admin/update-brand.mjs');
const { AdminUpdateUserAttributesCommand } = await import('@aws-sdk/client-cognito-identity-provider');
const { UpdateItemCommand, GetItemCommand, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');

describe('Update Brand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
    process.env.USER_POOL_ID = 'us-east-1_testpool123';
    process.env.HOSTING_BUCKET_NAME = 'bucket-123';
  });

  const makeEvent = (body) => ({
    body: JSON.stringify(body ?? {}),
    requestContext: {
      authorizer: {
        userId: 'user-1',
        email: 'user@example.com',
        tenantId: 'tenant-1', // overwrite per test for first-time path
      },
    },
  });

  test('first-time brand save: creates tenant, sets tenant_id on user, triggers finalization, publishes event, 204', async () => {
    // Simulate no tenant yet
    mockGetUserContext.mockReturnValue({
      userId: 'user-1',
      email: 'user@example.com',
      tenantId: null,
    });

    // BrandId availability check -> available (no Item)
    mockDynamoSend
      .mockResolvedValueOnce({ Item: undefined }) // GetItem: brand available
      .mockResolvedValueOnce({}) // PutItem: create tenant record
      // No updateBrandInfo on first-time create; skip UpdateItem
      ;

    // Cognito set custom:tenant_id
    mockCognitoSend.mockResolvedValue({});

    // EventBridge tenant finalization
    mockEventBridgeSend.mockResolvedValue({});

    const event = makeEvent({
      brandId: 'mybrand',
      brandName: 'My Brand',
      website: 'https://example.com',
      industry: 'Tech',
      brandDescription: 'desc',
      brandLogo: 'https://cdn/logo.png',
      tags: ['t1', 't2'],
    });

    const res = await handler(event);

    // Availability check
    expect(mockDynamoSend).toHaveBeenNthCalledWith(1, expect.objectContaining({ __type: 'GetItem' }));
    // Tenant create
    expect(mockDynamoSend).toHaveBeenNthCalledWith(2, expect.objectContaining({
      __type: 'PutItem',
      TableName: 'test-table',
      Item: expect.objectContaining({
        pk: 'mybrand',
        sk: 'tenant',
        createdBy: 'user-1',
        status: 'pending',
        subscribers: 0,
      }),
      ConditionExpression: 'attribute_not_exists(pk)',
    }));

    // Cognito set user attribute
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      __type: 'AdminUpdateUserAttributes',
      UserPoolId: 'us-east-1_testpool123',
      Username: 'user@example.com',
      UserAttributes: [{ Name: 'custom:tenant_id', Value: 'mybrand' }],
    }));

    // Finalization EB event
    expect(mockEventBridgeSend).toHaveBeenCalledWith(expect.objectContaining({
      __type: 'PutEvents',
      Entries: [
        expect.objectContaining({
          Source: 'newsletter.tenant',
          DetailType: 'Tenant Finalized',
          Detail: JSON.stringify({ tenantId: 'mybrand', userId: 'user-1' }),
        }),
      ],
    }));

    // Brand event published
    expect(mockPublishBrandEvent).toHaveBeenCalledTimes(1);
    const [tenantId, userId, eventType, details] = mockPublishBrandEvent.mock.calls[0];
    expect(tenantId).toBe('mybrand');
    expect(userId).toBe('user-1');
    expect(eventType).toBe('BRAND_UPDATED');
    expect(details).toMatchObject({
      brandId: 'mybrand',
      brandName: 'My Brand',
      website: 'https://example.com',
      industry: 'Tech',
      brandDescription: 'desc',
      brandLogo: 'https://cdn/logo.png',
      tags: ['t1', 't2'],
      isFirstTime: true,
    });
    expect(Array.isArray(details.updatedFields)).toBe(true);

    // 204 response
    expect(mockFormatEmptyResponse).toHaveBeenCalledWith(204);
    expect(res.statusCode).toBe(204);
  });

  test('subsequent update (has tenant): updates fields, triggers S3 cleanup when brandLogo changes, publishes event, 204', async () => {
    mockGetUserContext.mockReturnValue({
      userId: 'user-1',
      email: 'user@example.com',
      tenantId: 'tenant-1',
    });

    // UpdateItem returns old attributes containing old brandLogo so cleanup is triggered
    mockDynamoSend.mockResolvedValueOnce({
      Attributes: { brandLogo: 'https://old.cdn/brand-logos/logo-old.png' },
    });

    const event = makeEvent({
      brandName: 'New Name',
      website: 'https://new.example.com',
      brandLogo: 'https://new.cdn/brand-logos/logo-new.png',
    });

    const res = await handler(event);

    // UpdateItem called
    expect(mockDynamoSend).toHaveBeenCalledWith(expect.objectContaining({
      __type: 'UpdateItem',
      TableName: 'test-table',
      Key: { pk: 'tenant-1', sk: 'tenant' },
      ReturnValues: 'ALL_OLD',
      // UpdateExpression is built dynamically; just ensure present
      UpdateExpression: expect.stringContaining('SET'),
      ExpressionAttributeNames: expect.any(Object),
      ExpressionAttributeValues: expect.any(Object),
    }));

    // S3 cleanup EB event (brand logo changed)
    expect(mockEventBridgeSend).toHaveBeenCalledWith(expect.objectContaining({
      __type: 'PutEvents',
      Entries: [
        expect.objectContaining({
          Source: 'newsletter-service',
          DetailType: 'S3 Asset Cleanup',
        }),
      ],
    }));

    // Brand event published (not first time)
    expect(mockPublishBrandEvent).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'BRAND_UPDATED',
      expect.objectContaining({ isFirstTime: false, brandId: 'tenant-1' })
    );

    expect(res.statusCode).toBe(204);
  });

  test('brandId already taken -> 409', async () => {
    // No tenant yet (first-time path)
    mockGetUserContext.mockReturnValue({
      userId: 'user-1',
      email: 'user@example.com',
      tenantId: null,
    });

    // Availability check returns Item => taken
    mockDynamoSend.mockResolvedValueOnce({ Item: { pk: 'existing', sk: 'tenant' } });

    const event = makeEvent({ brandId: 'existing' });

    const res = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(409, expect.stringContaining("Brand ID 'existing' is already taken"));
    expect(res.statusCode).toBe(409);

    // No PutItem / no AdminUpdateUserAttributes / no EB finalization
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    expect(mockCognitoSend).not.toHaveBeenCalled();
    expect(mockEventBridgeSend).not.toHaveBeenCalled();
    expect(mockPublishBrandEvent).not.toHaveBeenCalled();
  });

  test('auth error -> formatAuthError result', async () => {
    mockGetUserContext.mockImplementation(() => {
      throw new Error('Invalid authorization context');
    });

    const event = makeEvent({ brandName: 'x' });
    const res = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Authentication required');
    expect(res.statusCode).toBe(401);
    expect(mockPublishBrandEvent).not.toHaveBeenCalled();
  });

  test('unexpected DDB error during update -> 500', async () => {
    mockGetUserContext.mockReturnValue({
      userId: 'user-1',
      email: 'user@example.com',
      tenantId: 'tenant-1',
    });

    mockDynamoSend.mockRejectedValueOnce(new Error('DDB fail'));

    const event = makeEvent({ brandName: 'oops' });
    const res = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(500, 'Failed to update brand details');
    expect(res.statusCode).toBe(500);
    expect(mockPublishBrandEvent).not.toHaveBeenCalled();
  });
});
