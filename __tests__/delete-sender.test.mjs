// __tests__/delete-sender.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let sesInstance;
let GetItemCommand;
let DeleteItemCommand;
let QueryCommand;
let UpdateItemCommand;
let DeleteEmailIdentityCommand;
let marshall;
let unmarshall;
let mockGetUserContext;
let mockFormatResponse;
let mockFormatEmptyResponse;
let mockFormatAuthError;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // DynamoDB client mock
    ddbInstance = { send: jest.fn() };
    sesInstance = { send: jest.fn() };

    // DynamoDB SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      DeleteItemCommand: jest.fn((params) => ({ __type: 'DeleteItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
    }));

    // SES SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => sesInstance),
      DeleteEmailIdentityCommand: jest.fn((params) => ({ __type: 'DeleteEmailIdentity', ...params })),
      DeleteTenantResourceAssociationCommand: jest.fn((params) => ({ __type: 'DeleteTenantResourceAssociation', ...params }))
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
    mockFormatEmptyResponse = jest.fn(() => ({
      statusCode: 204,
      body: '',
      headers: { 'Content-Type': 'application/json' },
    }));
    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      formatResponse: mockFormatResponse,
      formatEmptyResponse: mockFormatEmptyResponse,
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
    ({ handler } = await import('../functions/senders/delete-sender.mjs'));
    ({ GetItemCommand, DeleteItemCommand, QueryCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ DeleteEmailIdentityCommand } = await import('@aws-sdk/client-sesv2'));
    ({ marshall, unmarshall } = await import('@aws-sdk/util-dynamodb'));
  });

  return {
    handler,
    ddbInstance,
    sesInstance,
    GetItemCommand,
    DeleteItemCommand,
    QueryCommand,
    UpdateItemCommand,
    DeleteEmailIdentityCommand,
    marshall,
    unmarshall,
    mockGetUserContext,
    mockFormatResponse,
    mockFormatEmptyResponse,
    mockFormatAuthError,
  };
}

describe('delete-sender handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  test('returns 401 when no tenant access', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: null });

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('A brand is required before deleting a sender');
    expect(result.statusCode).toBe(401);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when senderId is missing', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      pathParameters: {}
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Sender Id is required');
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 404 when sender not found', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // Mock GetItem returning no item
    ddbInstance.send.mockResolvedValue({ Item: null });

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(404, 'Sender not found');
    expect(ddbInstance.send).toHaveBeenCalledTimes(1);
    expect(sesInstance.send).not.toHaveBeenCalled();

    const getCall = ddbInstance.send.mock.calls[0][0];
    expect(getCall.__type).toBe('GetItem');
  });

  test('successfully deletes non-default mailbox sender', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      verificationType: 'mailbox',
      isDefault: false
    };

    // Mock GetItem and DeleteItem
    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender }) // GetItem
      .mockResolvedValueOnce({}); // DeleteItem

    // Mock SES cleanup - should call both DeleteTenantResourceAssociation and DeleteEmailIdentity
    sesInstance.send.mockResolvedValue({});

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    expect(sesInstance.send).toHaveBeenCalledTimes(2); // Both tenant association and identity deletion

    // Verify SES cleanup calls
    const sesCall1 = sesInstance.send.mock.calls[0][0];
    expect(sesCall1.__type).toBe('DeleteTenantResourceAssociation');

    const sesCall2 = sesInstance.send.mock.calls[1][0];
    expect(sesCall2.__type).toBe('DeleteEmailIdentity');
    expect(sesCall2.EmailIdentity).toBe('test@example.com');

    // Verify DeleteItem call
    const deleteCall = ddbInstance.send.mock.calls[1][0];
    expect(deleteCall.__type).toBe('DeleteItem');
    expect(deleteCall.TableName).toBe('test-table');
    expect(deleteCall.ConditionExpression).toBe('attribute_exists(pk) AND attribute_exists(sk)');

    expect(mockFormatEmptyResponse).toHaveBeenCalled();
  });

  test('successfully deletes domain sender', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      domain: 'example.com',
      verificationType: 'domain',
      isDefault: false
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender })
      .mockResolvedValueOnce({});

    sesInstance.send.mockResolvedValue({});

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(sesInstance.send).toHaveBeenCalledTimes(2);

    // Verify SES cleanup uses domain
    const sesCall1 = sesInstance.send.mock.calls[0][0];
    expect(sesCall1.__type).toBe('DeleteTenantResourceAssociation');

    const sesCall2 = sesInstance.send.mock.calls[1][0];
    expect(sesCall2.__type).toBe('DeleteEmailIdentity');
    expect(sesCall2.EmailIdentity).toBe('example.com');

    expect(mockFormatEmptyResponse).toHaveBeenCalled();
  });

  test('deletes default sender and reassigns to another verified sender', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      verificationType: 'mailbox',
      isDefault: true
    };

    const otherSenders = [
      { senderId: 'sender-456', email: 'other@example.com', verificationStatus: 'pending' },
      { senderId: 'sender-789', email: 'verified@example.com', verificationStatus: 'verified' }
    ];

    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender }) // GetItem
      .mockResolvedValueOnce({ Items: otherSenders }) // Query for other senders
      .mockResolvedValueOnce({}) // UpdateItem for new default
      .mockResolvedValueOnce({}); // DeleteItem

    sesInstance.send.mockResolvedValue({});

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(4);

    // Verify Query call for other senders
    const queryCall = ddbInstance.send.mock.calls[1][0];
    expect(queryCall.__type).toBe('Query');
    expect(queryCall.IndexName).toBe('GSI1');

    // Verify UpdateItem call for new default (should pick verified sender)
    const updateCall = ddbInstance.send.mock.calls[2][0];
    expect(updateCall.__type).toBe('UpdateItem');
    expect(updateCall.UpdateExpression).toBe('SET isDefault = :isDefault, updatedAt = :updatedAt');

    expect(mockFormatEmptyResponse).toHaveBeenCalled();
  });

  test('deletes default sender and reassigns to first available when no verified', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      isDefault: true
    };

    const otherSenders = [
      { senderId: 'sender-456', email: 'other@example.com', verificationStatus: 'pending' }
    ];

    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender })
      .mockResolvedValueOnce({ Items: otherSenders })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    sesInstance.send.mockResolvedValue({});

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(4);
    expect(mockFormatEmptyResponse).toHaveBeenCalled();
  });

  test('deletes last remaining sender without reassigning default', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      isDefault: true
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender })
      .mockResolvedValueOnce({ Items: [] }) // No other senders
      .mockResolvedValueOnce({}); // DeleteItem

    sesInstance.send.mockResolvedValue({});

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(3); // No UpdateItem for reassignment
    expect(mockFormatEmptyResponse).toHaveBeenCalled();
  });

  test('continues deletion even when SES cleanup fails', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      verificationType: 'mailbox',
      isDefault: false
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender })
      .mockResolvedValueOnce({});

    // SES cleanup fails on first call (DeleteTenantResourceAssociation)
    sesInstance.send.mockRejectedValue(new Error('SES error'));

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    // Should still complete deletion despite SES error
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    expect(sesInstance.send).toHaveBeenCalledTimes(1); // Only first SES call attempted
    expect(mockFormatEmptyResponse).toHaveBeenCalled();
  });

  test('handles conditional check failure', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      isDefault: false
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender })
      .mockRejectedValueOnce(Object.assign(new Error('Conditional check failed'), {
        name: 'ConditionalCheckFailedException'
      }));

    sesInstance.send.mockResolvedValue({});

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(404, 'Sender not found');
  });

  test('handles invalid authorization context error', async () => {
    mockGetUserContext.mockImplementation(() => {
      throw new Error('Invalid authorization context');
    });

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Authentication required');
  });

  test('handles DynamoDB error during get', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send.mockRejectedValue(new Error('DynamoDB error'));

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(500, 'Failed to delete sender email');
  });

  test('handles missing pathParameters', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {};

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Sender Id is required');
  });

  test('continues with reassignment even if it fails', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingSender = {
      senderId: 'sender-123',
      email: 'test@example.com',
      isDefault: true
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Item: existingSender })
      .mockRejectedValueOnce(new Error('Query failed')) // Reassignment fails
      .mockResolvedValueOnce({}); // DeleteItem still succeeds

    sesInstance.send.mockResolvedValue({});

    const event = {
      pathParameters: { senderId: 'sender-123' }
    };

    const result = await handler(event);

    // Should still complete deletion despite reassignment error
    expect(mockFormatEmptyResponse).toHaveBeenCalled();
  });
});
