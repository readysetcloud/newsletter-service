import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let sesInstance;
let GetItemCommand;
let UpdateItemCommand;
let GetEmailIdentityCommand;
let marshall;
let unmarshall;
let mockGetUserContext;
let mockFormatResponse;
let mockFormatAuthError;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // DynamoDB client mock
    ddbInstance = { send: jest.fn() };

    // SES client mock
    sesInstance = { send: jest.fn() };

    // DynamoDB SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
    }));

    // SES SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => sesInstance),
      GetEmailIdentityCommand: jest.fn((params) => ({ __type: 'GetEmailIdentity', ...params })),
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
      statusCode: 403,
      body: JSON.stringify({ message }),
    }));
    jest.unstable_mockModule('../functions/auth/get-user-context.mjs', () => ({
      getUserContext: mockGetUserContext,
      formatAuthError: mockFormatAuthError,
    }));

    // Import after mocks
    ({ handler } = await import('../functions/senders/get-sender-status.mjs'));
    ({ GetItemCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ GetEmailIdentityCommand } = await import('@aws-sdk/client-sesv2'));
    ({ marshall, unmarshall } = await import('@aws-sdk/util-dynamodb'));
  });

  return {
    handler,
    ddbInstance,
    sesInstance,
    GetItemCommand,
    UpdateItemCommand,
    GetEmailIdentityCommand,
    marshall,
    unmarshall,
    mockGetUserContext,
    mockFormatResponse,
    mockFormatAuthError,
  };
}

describe('get-sender-status handler', () => {
  const mockEvent = {
    requestContext: {
      authorizer: {
        tenantId: 'test-tenant',
        userId: 'test-user'
      }
    },
    pathParameters: {
      senderId: 'test-sender-id'
    }
  };

  const mockSender = {
    senderId: 'test-sender-id',
    tenantId: 'test-tenant',
    email: 'test@example.com',
    name: 'Test Sender',
    verificationType: 'mailbox',
    verificationStatus: 'pending',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z',
    emailsSent: 0
  };

  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  test('returns 403 when no tenant access', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: null });

    const result = await handler(mockEvent);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Tenant access required');
    expect(result.statusCode).toBe(403);
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when senderId is missing', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant', userId: 'test-user' });

    const eventWithoutSenderId = {
      ...mockEvent,
      pathParameters: {}
    };

    const result = await handler(eventWithoutSenderId);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Missing senderId parameter');
    expect(result.statusCode).toBe(400);
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('returns 404 when sender not found', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant', userId: 'test-user' });
    ddbInstance.send.mockResolvedValueOnce({ Item: null });

    const result = await handler(mockEvent);

    expect(mockFormatResponse).toHaveBeenCalledWith(404, 'Sender not found');
    expect(result.statusCode).toBe(404);
    expect(ddbInstance.send).toHaveBeenCalledTimes(1);
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns sender status when sender exists and is already verified', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant', userId: 'test-user' });

    const verifiedSender = { ...mockSender, verificationStatus: 'verified' };
    ddbInstance.send.mockResolvedValueOnce({ Item: verifiedSender });

    const result = await handler(mockEvent);

    expect(ddbInstance.send).toHaveBeenCalledTimes(1);
    expect(sesInstance.send).not.toHaveBeenCalled(); // Should not check SES for verified senders
    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      senderId: 'test-sender-id',
      email: 'test@example.com',
      verificationStatus: 'verified',
      statusChanged: false
    }));
  });

  test('checks SES and updates status when sender is pending', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant', userId: 'test-user' });

    ddbInstance.send
      .mockResolvedValueOnce({ Item: mockSender }) // GetItem
      .mockResolvedValueOnce({}); // UpdateItem

    sesInstance.send.mockResolvedValueOnce({
      VerificationStatus: 'Success',
      DkimAttributes: { Status: 'Success' },
      IdentityType: 'EmailAddress'
    });

    const result = await handler(mockEvent);

    expect(ddbInstance.send).toHaveBeenCalledTimes(2); // GetItem + UpdateItem
    expect(sesInstance.send).toHaveBeenCalledTimes(1);

    const getItemCall = ddbInstance.send.mock.calls[0][0];
    expect(getItemCall.__type).toBe('GetItem');

    const updateItemCall = ddbInstance.send.mock.calls[1][0];
    expect(updateItemCall.__type).toBe('UpdateItem');

    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      senderId: 'test-sender-id',
      email: 'test@example.com',
      statusChanged: true,
      sesStatus: expect.objectContaining({
        verificationStatus: 'success'
      })
    }));
  });

  test('handles SES identity not found', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant', userId: 'test-user' });

    ddbInstance.send.mockResolvedValueOnce({ Item: mockSender });

    const notFoundError = new Error('Identity not found');
    notFoundError.name = 'NotFoundException';
    sesInstance.send.mockRejectedValueOnce(notFoundError);

    const result = await handler(mockEvent);

    expect(sesInstance.send).toHaveBeenCalledTimes(1);
    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      senderId: 'test-sender-id',
      email: 'test@example.com',
      statusChanged: false,
      sesStatus: expect.objectContaining({
        verificationStatus: 'not_found',
        error: 'Identity not found in SES'
      })
    }));
  });

  test('handles authentication errors', async () => {
    mockGetUserContext.mockImplementation(() => {
      throw new Error('Invalid authorization context');
    });

    const result = await handler(mockEvent);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Authentication required');
    expect(result.statusCode).toBe(403);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('handles database errors', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant', userId: 'test-user' });
    ddbInstance.send.mockRejectedValueOnce(new Error('Database error'));

    const result = await handler(mockEvent);

    expect(mockFormatResponse).toHaveBeenCalledWith(500, 'Failed to get sender status');
    expect(result.statusCode).toBe(500);
  });

  test('maps SES status correctly - Success to verified', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant', userId: 'test-user' });

    ddbInstance.send
      .mockResolvedValueOnce({ Item: mockSender })
      .mockResolvedValueOnce({});

    sesInstance.send.mockResolvedValueOnce({
      VerificationStatus: 'Success',
      DkimAttributes: { Status: 'Success' },
      IdentityType: 'EmailAddress'
    });

    const result = await handler(mockEvent);

    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      statusChanged: true
    }));
  });

  test('maps SES status correctly - Failed to failed', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant', userId: 'test-user' });

    ddbInstance.send
      .mockResolvedValueOnce({ Item: mockSender })
      .mockResolvedValueOnce({});

    sesInstance.send.mockResolvedValueOnce({
      VerificationStatus: 'Failed',
      DkimAttributes: { Status: 'Failed' },
      IdentityType: 'EmailAddress'
    });

    const result = await handler(mockEvent);

    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      statusChanged: true
    }));
  });

  test('does not update database when SES status matches current status', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'test-tenant', userId: 'test-user' });

    ddbInstance.send.mockResolvedValueOnce({ Item: mockSender });

    sesInstance.send.mockResolvedValueOnce({
      VerificationStatus: 'Pending', // Same as current status
      DkimAttributes: { Status: 'Pending' },
      IdentityType: 'EmailAddress'
    });

    const result = await handler(mockEvent);

    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only GetItem, no UpdateItem
    expect(sesInstance.send).toHaveBeenCalledTimes(1);
    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      statusChanged: false
    }));
  });
});
