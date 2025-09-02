// __tests__/check-sender-status-automatically.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let scheduleInitialStatusCheck;
let ddbInstance;
let sesInstance;
let schedulerInstance;
let GetItemCommand;
let UpdateItemCommand;
let GetEmailIdentityCommand;
let DeleteEmailIdentityCommand;

let CreateScheduleCommand;
let marshall;
let unmarshall;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // DynamoDB client mock
    ddbInstance = { send: jest.fn() };

    // SES client mock
    sesInstance = { send: jest.fn() };

    // Scheduler client mock
    schedulerInstance = { send: jest.fn() };

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
      DeleteEmailIdentityCommand: jest.fn((params) => ({ __type: 'DeleteEmailIdentity', ...params })),
      DeleteTenantResourceAssociationCommand: jest.fn((params) => ({ __type: 'DeleteTenantResourceAssociation', ...params }))
    }));

    // Scheduler SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-scheduler', () => ({
      SchedulerClient: jest.fn(() => schedulerInstance),
      CreateScheduleCommand: jest.fn((params) => ({ __type: 'CreateSchedule', ...params })),
    }));

    // DynamoDB util mocks
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    // Import after mocks
    ({ handler, scheduleInitialStatusCheck } = await import('../functions/senders/check-sender-status-automatically.mjs'));
    ({ GetItemCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ GetEmailIdentityCommand, DeleteEmailIdentityCommand } = await import('@aws-sdk/client-sesv2'));
    ({ CreateScheduleCommand } = await import('@aws-sdk/client-scheduler'));
    ({ marshall, unmarshall } = await import('@aws-sdk/util-dynamodb'));
  });

  return {
    handler,
    scheduleInitialStatusCheck,
    ddbInstance,
    sesInstance,
    schedulerInstance,
    GetItemCommand,
    UpdateItemCommand,
    GetEmailIdentityCommand,
    DeleteEmailIdentityCommand,

    CreateScheduleCommand,
    marshall,
    unmarshall
  };
}

describe('check-sender-status-automatically handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/test-role';
    process.env.AWS_ACCOUNT_ID = '123456789012';
    process.env.AWS_REGION = 'us-east-1';
    await loadIsolated();
  });

  test('should timeout sender after 24 hours and cleanup SES identity', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 5,
        expiresAt: new Date(Date.now() - 1000).toISOString() // 1 second ago (expired)
      }
    };

    const mockSender = {
      senderId: 'sender-456',
      tenantId: 'tenant-123',
      email: 'test@example.com',
      verificationType: 'mailbox',
      verificationStatus: 'pending',
      verificationInitiatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
      verificationExpiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago (expired)
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({
          Item: marshall(mockSender)
        });
      }
      if (command.__type === 'UpdateItem') {
        return Promise.resolve({});
      }
    });

    sesInstance.send.mockImplementation((command) => {
      if (command.__type === 'DeleteTenantResourceAssociation') {
        return Promise.resolve({});
      }
      if (command.__type === 'DeleteEmailIdentity') {
        return Promise.resolve({});
      }
    });

    await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(2); // GetItem + UpdateItem
    expect(sesInstance.send).toHaveBeenCalledTimes(2); // Both DeleteTenantResourceAssociation and DeleteEmailIdentity

    // Verify SES cleanup calls
    const tenantAssociationCall = sesInstance.send.mock.calls.find(call => call[0].__type === 'DeleteTenantResourceAssociation')[0];
    expect(tenantAssociationCall).toBeDefined();

    const identityDeletionCall = sesInstance.send.mock.calls.find(call => call[0].__type === 'DeleteEmailIdentity')[0];
    expect(identityDeletionCall.EmailIdentity).toBe('test@example.com');

    // Verify the update call includes timeout status
    const updateCall = ddbInstance.send.mock.calls.find(call => call[0].__type === 'UpdateItem')[0];
    expect(updateCall.ExpressionAttributeValues[':status']).toBe('verification_timed_out');
  });

  test('should cleanup domain verification on timeout', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 5,
        expiresAt: new Date(Date.now() - 1000).toISOString()
      }
    };

    const mockSender = {
      senderId: 'sender-456',
      tenantId: 'tenant-123',
      domain: 'example.com',
      verificationType: 'domain',
      verificationStatus: 'pending',
      verificationInitiatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      verificationExpiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({
          Item: marshall(mockSender)
        });
      }
      if (command.__type === 'UpdateItem') {
        return Promise.resolve({});
      }
    });

    sesInstance.send.mockImplementation((command) => {
      if (command.__type === 'DeleteTenantResourceAssociation') {
        return Promise.resolve({});
      }
      if (command.__type === 'DeleteEmailIdentity') {
        return Promise.resolve({});
      }
    });

    await handler(event);

    expect(sesInstance.send).toHaveBeenCalledTimes(2); // Both DeleteTenantResourceAssociation and DeleteEmailIdentity

    // Verify domain cleanup
    const tenantAssociationCall = sesInstance.send.mock.calls.find(call => call[0].__type === 'DeleteTenantResourceAssociation')[0];
    expect(tenantAssociationCall).toBeDefined();

    const identityDeletionCall = sesInstance.send.mock.calls.find(call => call[0].__type === 'DeleteEmailIdentity')[0];
    expect(identityDeletionCall.EmailIdentity).toBe('example.com');
  });

  test('should continue with status update if SES cleanup fails', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 5,
        expiresAt: new Date(Date.now() - 1000).toISOString()
      }
    };

    const mockSender = {
      senderId: 'sender-456',
      tenantId: 'tenant-123',
      email: 'test@example.com',
      verificationType: 'mailbox',
      verificationStatus: 'pending',
      verificationInitiatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      verificationExpiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({
          Item: marshall(mockSender)
        });
      }
      if (command.__type === 'UpdateItem') {
        return Promise.resolve({});
      }
    });

    sesInstance.send.mockImplementation((command) => {
      if (command.__type === 'DeleteTenantResourceAssociation') {
        return Promise.resolve({});
      }
      if (command.__type === 'DeleteEmailIdentity') {
        return Promise.reject(new Error('SES cleanup failed'));
      }
    });

    await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(2); // GetItem + UpdateItem (should still update status)
    expect(sesInstance.send).toHaveBeenCalledTimes(2); // Both DeleteTenantResourceAssociation and DeleteEmailIdentity attempted

    // Verify the update call still includes timeout status
    const updateCall = ddbInstance.send.mock.calls.find(call => call[0].__type === 'UpdateItem')[0];
    expect(updateCall.ExpressionAttributeValues[':status']).toBe('verification_timed_out');
  });

  test('should handle cleanup gracefully when SES fails', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 5,
        expiresAt: new Date(Date.now() - 1000).toISOString()
      }
    };

    const mockSender = {
      senderId: 'sender-456',
      tenantId: 'tenant-123',
      email: 'test@example.com',
      verificationType: 'mailbox',
      verificationStatus: 'pending',
      verificationInitiatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      verificationExpiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({
          Item: marshall(mockSender)
        });
      }
      if (command.__type === 'UpdateItem') {
        return Promise.resolve({});
      }
    });

    sesInstance.send.mockImplementation((command) => {
      if (command.__type === 'DeleteTenantResourceAssociation') {
        return Promise.resolve({});
      }
      if (command.__type === 'DeleteEmailIdentity') {
        return Promise.reject(new Error('SES service error'));
      }
    });

    await handler(event);

    expect(sesInstance.send).toHaveBeenCalledTimes(2); // Both calls attempted

    // Verify both SES calls were made
    const tenantAssociationCall = sesInstance.send.mock.calls.find(call => call[0].__type === 'DeleteTenantResourceAssociation')[0];
    expect(tenantAssociationCall).toBeDefined();

    const identityDeletionCall = sesInstance.send.mock.calls.find(call => call[0].__type === 'DeleteEmailIdentity')[0];
    expect(identityDeletionCall.EmailIdentity).toBe('test@example.com');
  });
});
