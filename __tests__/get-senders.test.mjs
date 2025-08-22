// __tests__/get-senders.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let QueryCommand;
let marshall;
let unmarshall;
let mockGetUserContext;
let mockFormatResponse;
let mockFormatAuthError;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // DynamoDB client mock
    ddbInstance = { send: jest.fn() };

    // DynamoDB SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    // util-dynamodb mocks
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    // helpers mock
    mockFormatResponse = jest.fn((statusCode, body) => ({
      statusCode,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }));
    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      formatResponse: mockFormatResponse,
    }));

    // auth context mock
    mockGetUserContext = jest.fn();
    mockFormatAuthError = jest.fn((message) => ({
      statusCode: 401,
      body: JSON.stringify({ error: message }),
    }));
    jest.unstable_mockModule('../functions/auth/get-user-context.mjs', () => ({
      getUserContext: mockGetUserContext,
      formatAuthError: mockFormatAuthError,
    }));

    // Import after mocks
    ({ handler } = await import('../functions/senders/get-senders.mjs'));
    ({ QueryCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ marshall, unmarshall } = await import('@aws-sdk/util-dynamodb'));
  });

  return {
    handler,
    ddbInstance,
    QueryCommand,
    marshall,
    unmarshall,
    mockGetUserContext,
    mockFormatResponse,
    mockFormatAuthError,
  };
}

describe('get-senders handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  test('returns 401 when no tenant access', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: null });

    const event = {
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Tenant access required');
    expect(result.statusCode).toBe(401);
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('returns senders with tier limits for free tier', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const mockSenders = [
      {
        senderId: 'sender-1',
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'mailbox',
        verificationStatus: 'verified',
        isDefault: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        verifiedAt: '2024-01-01T01:00:00Z'
      }
    ];

    ddbInstance.send.mockResolvedValue({
      Items: mockSenders
    });

    const event = {
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockGetUserContext).toHaveBeenCalledWith(event);
    expect(ddbInstance.send).toHaveBeenCalledTimes(1);

    const queryCall = ddbInstance.send.mock.calls[0][0];
    expect(queryCall.__type).toBe('Query');
    expect(queryCall.TableName).toBe('test-table');
    expect(queryCall.IndexName).toBe('GSI1');

    expect(mockFormatResponse).toHaveBeenCalledWith(200, {
      senders: [{
        senderId: 'sender-1',
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'mailbox',
        verificationStatus: 'verified',
        isDefault: true,
        domain: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        verifiedAt: '2024-01-01T01:00:00Z',
        failureReason: null
      }],
      tierLimits: {
        tier: 'free-tier',
        maxSenders: 1,
        currentCount: 1,
        canUseDNS: false,
        canUseMailbox: true
      }
    });
  });

  test('returns senders with tier limits for creator tier', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send.mockResolvedValue({
      Items: []
    });

    const event = {
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(200, {
      senders: [],
      tierLimits: {
        tier: 'creator-tier',
        maxSenders: 2,
        currentCount: 0,
        canUseDNS: true,
        canUseMailbox: true
      }
    });
  });

  test('returns senders with tier limits for pro tier', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send.mockResolvedValue({
      Items: []
    });

    const event = {
      requestContext: { authorizer: { tier: 'pro-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(200, {
      senders: [],
      tierLimits: {
        tier: 'pro-tier',
        maxSenders: 5,
        currentCount: 0,
        canUseDNS: true,
        canUseMailbox: true
      }
    });
  });

  test('defaults to free tier when tier not specified', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send.mockResolvedValue({
      Items: []
    });

    const event = {
      requestContext: { authorizer: {} }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(200, {
      senders: [],
      tierLimits: {
        tier: 'free-tier',
        maxSenders: 1,
        currentCount: 0,
        canUseDNS: false,
        canUseMailbox: true
      }
    });
  });

  test('handles DynamoDB query error', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send.mockRejectedValue(new Error('DynamoDB error'));

    const event = {
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(500, 'Failed to retrieve sender emails');
  });

  test('handles invalid authorization context error', async () => {
    mockGetUserContext.mockImplementation(() => {
      throw new Error('Invalid authorization context');
    });

    const event = {
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Authentication required');
  });

  test('formats sender response correctly with all fields', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const mockSenders = [
      {
        senderId: 'sender-1',
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'domain',
        verificationStatus: 'failed',
        isDefault: false,
        domain: 'example.com',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        failureReason: 'DNS records not found'
      }
    ];

    ddbInstance.send.mockResolvedValue({
      Items: mockSenders
    });

    const event = {
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(200, {
      senders: [{
        senderId: 'sender-1',
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'domain',
        verificationStatus: 'failed',
        isDefault: false,
        domain: 'example.com',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        verifiedAt: null,
        failureReason: 'DNS records not found'
      }],
      tierLimits: {
        tier: 'creator-tier',
        maxSenders: 2,
        currentCount: 1,
        canUseDNS: true,
        canUseMailbox: true
      }
    });
  });
});
