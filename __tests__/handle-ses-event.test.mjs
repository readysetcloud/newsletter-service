// __tests__/handle-ses-event.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let QueryCommand;
let UpdateItemCommand;
let ScanCommand;
let marshall;
let unmarshall;
let mockMomentoClient;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // DynamoDB client mock
    ddbInstance = { send: jest.fn() };

    // DynamoDB SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      ScanCommand: jest.fn((params) => ({ __type: 'Scan', ...params })),
    }));

    // util-dynamodb mocks
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    // Momento client mock
    mockMomentoClient = {
      isAvailable: jest.fn(() => true),
      generateWriteToken: jest.fn(() => Promise.resolve('mock-token')),
      publishNotification: jest.fn(() => Promise.resolve())
    };
    jest.unstable_mockModule('../functions/utils/momento-client.mjs', () => ({
      momentoClient: mockMomentoClient,
    }));

    // Import after mocks
    ({ handler } = await import('../functions/senders/handle-ses-event.mjs'));
    ({ QueryCommand, UpdateItemCommand, ScanCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ marshall, unmarshall } = await import('@aws-sdk/util-dynamodb'));
  });

  return {
    handler,
    ddbInstance,
    QueryCommand,
    UpdateItemCommand,
    ScanCommand,
    marshall,
    unmarshall,
    mockMomentoClient,
  };
}

describe('handle-ses-event handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  test('processes domain verification success event', async () => {
    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'pending'
    };

    // Mock finding domain records
    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] }) // Scan for domain records
      .mockResolvedValueOnce({}); // UpdateItem

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationSuccess',
            identity: 'example.com',
            status: 'success'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);

    // Verify Scan call for finding domain records
    const scanCall = ddbInstance.send.mock.calls[0][0];
    expect(scanCall.__type).toBe('Scan');
    expect(scanCall.FilterExpression).toContain('sk = :sk');

    // Verify UpdateItem call
    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.__type).toBe('UpdateItem');
    expect(updateCall.UpdateExpression).toContain('verificationStatus = :status');
    expect(updateCall.UpdateExpression).toContain('verifiedAt = :verifiedAt');

    // Verify Momento notification
    expect(mockMomentoClient.generateWriteToken).toHaveBeenCalledWith('tenant-123');
    expect(mockMomentoClient.publishNotification).toHaveBeenCalledWith(
      'mock-token',
      'tenant-123',
      expect.objectContaining({
        type: 'domain-verification-update',
        domain: 'example.com',
        status: 'verified'
      })
    );
  });

  test('processes domain verification failure event', async () => {
    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'pending'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] })
      .mockResolvedValueOnce({});

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationFailure',
            identity: 'example.com',
            reason: 'DNS records not found'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);

    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.UpdateExpression).toContain('failureReason = :failureReason');

    expect(mockMomentoClient.publishNotification).toHaveBeenCalledWith(
      'mock-token',
      'tenant-123',
      expect.objectContaining({
        type: 'domain-verification-update',
        domain: 'example.com',
        status: 'failed',
        failureReason: 'DNS records not found'
      })
    );
  });

  test('processes sender email verification success event', async () => {
    const senderRecord = {
      tenantId: 'tenant-123',
      senderId: 'sender-456',
      email: 'test@example.com',
      verificationStatus: 'pending'
    };

    // Mock finding sender records
    ddbInstance.send
      .mockResolvedValueOnce({ Items: [senderRecord] }) // Query for sender records
      .mockResolvedValueOnce({}); // UpdateItem

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationSuccess',
            identity: 'test@example.com'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);

    // Verify Query call for finding sender records
    const queryCall = ddbInstance.send.mock.calls[0][0];
    expect(queryCall.__type).toBe('Query');
    expect(queryCall.IndexName).toBe('GSI1');
    expect(queryCall.KeyConditionExpression).toContain('GSI1SK = :email');

    // Verify UpdateItem call
    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.__type).toBe('UpdateItem');
    expect(updateCall.UpdateExpression).toContain('verificationStatus = :status');

    // Verify Momento notification
    expect(mockMomentoClient.publishNotification).toHaveBeenCalledWith(
      'mock-token',
      'tenant-123',
      expect.objectContaining({
        type: 'sender-verification-update',
        senderId: 'sender-456',
        email: 'test@example.com',
        status: 'verified'
      })
    );
  });

  test('processes sender email verification failure event', async () => {
    const senderRecord = {
      tenantId: 'tenant-123',
      senderId: 'sender-456',
      email: 'test@example.com',
      verificationStatus: 'pending'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [senderRecord] })
      .mockResolvedValueOnce({});

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationFailure',
            identity: 'test@example.com',
            reason: 'Invalid email address'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);

    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.UpdateExpression).toContain('failureReason = :failureReason');

    expect(mockMomentoClient.publishNotification).toHaveBeenCalledWith(
      'mock-token',
      'tenant-123',
      expect.objectContaining({
        type: 'sender-verification-update',
        status: 'failed',
        failureReason: 'Invalid email address'
      })
    );
  });

  test('processes multiple records in single event', async () => {
    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'pending'
    };

    const senderRecord = {
      tenantId: 'tenant-456',
      senderId: 'sender-789',
      email: 'test@another.com',
      verificationStatus: 'pending'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] }) // Domain scan
      .mockResolvedValueOnce({}) // Domain update
      .mockResolvedValueOnce({ Items: [senderRecord] }) // Sender query
      .mockResolvedValueOnce({}); // Sender update

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationSuccess',
            identity: 'example.com'
          }
        },
        {
          detail: {
            'event-type': 'identityVerificationSuccess',
            identity: 'test@another.com'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(4);
    expect(mockMomentoClient.publishNotification).toHaveBeenCalledTimes(2);
  });

  test('skips processing when no identity in event', async () => {
    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationSuccess'
            // No identity field
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(mockMomentoClient.publishNotification).not.toHaveBeenCalled();
  });

  test('skips processing for unhandled event types', async () => {
    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'pending'
    };

    ddbInstance.send.mockResolvedValue({ Items: [domainRecord] });

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'unknownEventType',
            identity: 'example.com'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only scan, no update
    expect(mockMomentoClient.publishNotification).not.toHaveBeenCalled();
  });

  test('does not update when status unchanged', async () => {
    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'verified' // Already verified
    };

    ddbInstance.send.mockResolvedValue({ Items: [domainRecord] });

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationSuccess',
            identity: 'example.com'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only scan, no update
    expect(mockMomentoClient.publishNotification).not.toHaveBeenCalled();
  });

  test('continues processing when Momento is not available', async () => {
    mockMomentoClient.isAvailable.mockReturnValue(false);

    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'pending'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] })
      .mockResolvedValueOnce({});

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationSuccess',
            identity: 'example.com'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    expect(mockMomentoClient.publishNotification).not.toHaveBeenCalled();
  });

  test('continues processing when Momento notification fails', async () => {
    mockMomentoClient.publishNotification.mockRejectedValue(new Error('Momento error'));

    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'pending'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] })
      .mockResolvedValueOnce({});

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationSuccess',
            identity: 'example.com'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
  });

  test('handles DynamoDB errors gracefully', async () => {
    ddbInstance.send.mockRejectedValue(new Error('DynamoDB error'));

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationSuccess',
            identity: 'example.com'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Failed to process SES events'
    });
  });

  test('handles empty Records array', async () => {
    const event = {
      Records: []
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('handles missing Records field', async () => {
    const event = {};

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  test('removes failure reason when verification succeeds', async () => {
    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'failed',
      failureReason: 'Previous failure'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] })
      .mockResolvedValueOnce({});

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'identityVerificationSuccess',
            identity: 'example.com'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);

    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.UpdateExpression).toContain('REMOVE failureReason');
  });

  test('processes domain verification event with specific status', async () => {
    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'pending'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] })
      .mockResolvedValueOnce({});

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'domainVerification',
            identity: 'example.com',
            status: 'success'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockMomentoClient.publishNotification).toHaveBeenCalledWith(
      'mock-token',
      'tenant-123',
      expect.objectContaining({
        status: 'verified'
      })
    );
  });

  test('processes domain verification failure with specific status', async () => {
    const domainRecord = {
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationStatus: 'pending'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] })
      .mockResolvedValueOnce({});

    const event = {
      Records: [
        {
          detail: {
            'event-type': 'domainVerification',
            identity: 'example.com',
            status: 'failure',
            reason: 'DNS timeout'
          }
        }
      ]
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockMomentoClient.publishNotification).toHaveBeenCalledWith(
      'mock-token',
      'tenant-123',
      expect.objectContaining({
        status: 'failed',
        failureReason: 'DNS timeout'
      })
    );
  });
});
