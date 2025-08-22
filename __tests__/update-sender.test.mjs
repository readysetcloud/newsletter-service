// __tests__/update-sender.test.mjs
import { jest, describe, test, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let GetItemCommand;
let UpdateItemCommand;
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
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
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
    ({ handler } = await import('../functions/senders/update-sender.mjs'));
    ({ GetItemCommand, UpdateItemCommand, QueryCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ marshall, unmarshall } = await import('@aws-sdk/util-dynamodb'));
  });

  return {
    handler,
    ddbInstance,
    GetItemCommand,
    UpdateItemCommand,
    QueryCommand,
    marshall,
    unmarshall,
    mockGetUserContext,
    mockFormatResponse,
    mockFormatAuthError,
  };
}

describe('update-sender handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  test('returns 401 when no tenant access', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: null });

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ name: 'Updated Name' })
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Tenant access required');
    expect(result.statusCode).toBe(401);
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when senderId is missing', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      pathParameters: {},
      body: JSON.stringify({ name: 'Updated Name' })
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Sender ID is required');
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when no fields provided for update', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({})
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'At least one field must be provided for update');
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when name is not a string', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ name: 123 })
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Name must be a string');
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when isDefault is not a boolean', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ isDefault: 'true' })
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'isDefault must be a boolean');
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('returns 404 when sender not found', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // Mock GetItem returning no item
    ddbInstance.send.mockResolvedValue({ Item: null });

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ name: 'Updated Name' })
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(404, 'Sender not found');
    expect(ddbInstance.send).toHaveBeenCalledTimes(1);

    const getCall = ddbInstance.send.mock.calls[0][0];
    expect(getCall.__type).toBe('GetItem');
  });

  test('successfully updates sender name', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      name: 'Old Name',
      verificationType: 'mailbox',
      verificationStatus: 'verified',
      isDefault: false,
      createdAt: '2024-01-01T00:00:00Z'
    };

    const updatedSender = {
      ...existingSender,
      name: 'Updated Name',
      updatedAt: '2024-01-02T00:00:00Z'
    };

    // Mock GetItem and UpdateItem
    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender }) // GetItem
      .mockResolvedValueOnce({ Attributes: updatedSender }); // UpdateItem

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ name: 'Updated Name' })
    };

    const result = await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(2);

    // Verify UpdateItem call
    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.__type).toBe('UpdateItem');
    expect(updateCall.TableName).toBe('test-table');
    expect(updateCall.UpdateExpression).toContain('#name = :name');
    expect(updateCall.UpdateExpression).toContain('updatedAt = :updatedAt');
    expect(updateCall.ConditionExpression).toBe('attribute_exists(pk) AND attribute_exists(sk)');
    expect(updateCall.ReturnValues).toBe('ALL_NEW');

    expect(mockFormatResponse).toHaveBeenCalledWith(200, {
      senderId: 'sender-123',
      email: 'test@example.com',
      name: 'Updated Name',
      verificationType: 'mailbox',
      verificationStatus: 'verified',
      isDefault: false,
      domain: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      verifiedAt: null,
      failureReason: null
    });
  });

  test('successfully sets sender as default and unsets others', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      isDefault: false
    };

    const updatedSender = {
      ...existingSender,
      isDefault: true,
      updatedAt: '2024-01-02T00:00:00Z'
    };

    const otherSenders = [
      { senderId: 'sender-456', isDefault: true },
      { senderId: 'sender-789', isDefault: false }
    ];

    // Mock GetItem, Query for other senders, UpdateItem for current, UpdateItem for others
    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender }) // GetItem
      .mockResolvedValueOnce({ Items: otherSenders }) // Query for other senders
      .mockResolvedValueOnce({}) // UpdateItem for other sender
      .mockResolvedValueOnce({ Attributes: updatedSender }); // UpdateItem for current sender

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ isDefault: true })
    };

    const result = await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(4);

    // Verify Query call for other senders
    const queryCall = ddbInstance.send.mock.calls[1][0];
    expect(queryCall.__type).toBe('Query');
    expect(queryCall.IndexName).toBe('GSI1');

    // Verify UpdateItem call for unsetting other default
    const unsetCall = ddbInstance.send.mock.calls[2][0];
    expect(unsetCall.__type).toBe('UpdateItem');
    expect(unsetCall.UpdateExpression).toBe('SET isDefault = :isDefault, updatedAt = :updatedAt');

    // Verify final UpdateItem call for current sender
    const updateCall = ddbInstance.send.mock.calls[3][0];
    expect(updateCall.__type).toBe('UpdateItem');
    expect(updateCall.UpdateExpression).toContain('isDefault = :isDefault');

    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      isDefault: true
    }));
  });

  test('allows setting name to null', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      name: 'Old Name'
    };

    const updatedSender = {
      ...existingSender,
      name: null,
      updatedAt: '2024-01-02T00:00:00Z'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender })
      .mockResolvedValueOnce({ Attributes: updatedSender });

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ name: null })
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      name: null
    }));
  });

  test('handles conditional check failure', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Item: { senderId: 'sender-123' } })
      .mockRejectedValueOnce(Object.assign(new Error('Conditional check failed'), {
        name: 'ConditionalCheckFailedException'
      }));

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ name: 'Updated Name' })
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(404, 'Sender not found');
  });

  test('handles invalid authorization context error', async () => {
    mockGetUserContext.mockImplementation(() => {
      throw new Error('Invalid authorization context');
    });

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ name: 'Updated Name' })
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Authentication required');
  });

  test('handles DynamoDB error during get', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send.mockRejectedValue(new Error('DynamoDB error'));

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ name: 'Updated Name' })
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(500, 'Failed to update sender email');
  });

  test('handles missing request body', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'At least one field must be provided for update');
  });

  test('updates both name and isDefault together', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      name: 'Old Name',
      isDefault: false
    };

    const updatedSender = {
      ...existingSender,
      name: 'New Name',
      isDefault: true,
      updatedAt: '2024-01-02T00:00:00Z'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender }) // GetItem
      .mockResolvedValueOnce({ Items: [] }) // Query (no other defaults)
      .mockResolvedValueOnce({ Attributes: updatedSender }); // UpdateItem

    const event = {
      pathParameters: { senderId: 'sender-123' },
      body: JSON.stringify({ name: 'New Name', isDefault: true })
    };

    const result = await handler(event);

    const updateCall = ddbInstance.send.mock.calls[2][0];
    expect(updateCall.UpdateExpression).toContain('#name = :name');
    expect(updateCall.UpdateExpression).toContain('isDefault = :isDefault');
    expect(updateCall.UpdateExpression).toContain('updatedAt = :updatedAt');

    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      name: 'New Name',
      isDefault: true
    }));
  });
});
