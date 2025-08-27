import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler, scheduleInitialStatusCheck;
let ddbInstance;
let sesInstance;
let schedulerInstance;
let GetItemCommand;
let UpdateItemCommand;
let GetEmailIdentityCommand;
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
    }));

    // Scheduler SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-scheduler', () => ({
      SchedulerClient: jest.fn(() => schedulerInstance),
      CreateScheduleCommand: jest.fn((params) => ({ __type: 'CreateSchedule', ...params })),
    }));

    // util-dynamodb mocks
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    // Import after mocks
    ({ handler, scheduleInitialStatusCheck } = await import('../functions/senders/check-sender-status-automatically.mjs'));
    ({ GetItemCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ GetEmailIdentityCommand } = await import('@aws-sdk/client-sesv2'));
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
    CreateScheduleCommand,
    marshall,
    unmarshall,
  };
}

describe('check-sender-status-automatically handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/test-role';
    await loadIsolated();
  });

  test('should update sender status when SES verification succeeds', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 0,
        expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString() // 23 hours from now
      }
    };

    const mockSender = {
      senderId: 'sender-456',
      email: 'test@example.com',
      verificationStatus: 'pending',
      createdAt: new Date().toISOString()
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({ Item: mockSender });
      }
      if (command.__type === 'UpdateItem') {
        return Promise.resolve({});
      }
    });

    sesInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetEmailIdentity') {
        return Promise.resolve({
          VerificationStatus: 'Success',
          DkimAttributes: { Status: 'Success' },
          IdentityType: 'EmailAddress'
        });
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(2); // GetItem + UpdateItem
    expect(sesInstance.send).toHaveBeenCalledTimes(1);

    const responseBody = JSON.parse(result.body);
    expect(responseBody.action).toBe('status_updated');
    expect(responseBody.newStatus).toBe('verified');
  });

  test('should timeout sender after 24 hours', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 5,
        expiresAt: new Date(Date.now() - 1000).toISOString() // 1 second ago (expired)
      }
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'UpdateItem') {
        return Promise.resolve({});
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only UpdateItem
    expect(sesInstance.send).not.toHaveBeenCalled(); // Should not check SES for expired

    const responseBody = JSON.parse(result.body);
    expect(responseBody.action).toBe('timed_out');

    // Verify the update call includes timeout status
    const updateCall = ddbInstance.send.mock.calls.find(call => call[0].__type === 'UpdateItem')[0];
    expect(updateCall.ExpressionAttributeValues[':status']).toBe('verification_timed_out');
  });

  test('should skip already verified senders', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 2,
        expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString()
      }
    };

    const mockSender = {
      senderId: 'sender-456',
      email: 'test@example.com',
      verificationStatus: 'verified', // Already verified
      createdAt: new Date().toISOString()
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({ Item: mockSender });
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only GetItem
    expect(sesInstance.send).not.toHaveBeenCalled();
    expect(schedulerInstance.send).not.toHaveBeenCalled();

    const responseBody = JSON.parse(result.body);
    expect(responseBody.action).toBe('stopped');
  });

  test('should schedule next check when no status change', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 1,
        expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString()
      }
    };

    const mockSender = {
      senderId: 'sender-456',
      email: 'test@example.com',
      verificationStatus: 'pending',
      createdAt: new Date().toISOString()
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({ Item: mockSender });
      }
    });

    sesInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetEmailIdentity') {
        return Promise.resolve({
          VerificationStatus: 'Pending', // Same as current status
          DkimAttributes: { Status: 'Pending' },
          IdentityType: 'EmailAddress'
        });
      }
    });

    schedulerInstance.send.mockImplementation((command) => {
      if (command.__type === 'CreateSchedule') {
        return Promise.resolve({});
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only GetItem
    expect(sesInstance.send).toHaveBeenCalledTimes(1);
    expect(schedulerInstance.send).toHaveBeenCalledTimes(1); // Schedule next check

    const responseBody = JSON.parse(result.body);
    expect(responseBody.action).toBe('next_check_scheduled');
    expect(responseBody.retryCount).toBe(2);
  });

  test('should handle SES API errors and schedule retry', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 3,
        expiresAt: new Date(Date.now() + 15 * 60 * 60 * 1000).toISOString()
      }
    };

    const mockSender = {
      senderId: 'sender-456',
      email: 'test@example.com',
      verificationStatus: 'pending',
      createdAt: new Date().toISOString()
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({ Item: mockSender });
      }
    });

    sesInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetEmailIdentity') {
        return Promise.reject(new Error('SES API error'));
      }
    });

    schedulerInstance.send.mockImplementation((command) => {
      if (command.__type === 'CreateSchedule') {
        return Promise.resolve({});
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only GetItem
    expect(sesInstance.send).toHaveBeenCalledTimes(1);
    expect(schedulerInstance.send).toHaveBeenCalledTimes(1); // Schedule retry

    const responseBody = JSON.parse(result.body);
    expect(responseBody.action).toBe('retry_scheduled');
    expect(responseBody.retryCount).toBe(4);
  });

  test('should handle sender not found', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 1,
        expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString()
      }
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({ Item: null }); // Sender not found
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only GetItem
    expect(sesInstance.send).not.toHaveBeenCalled();
    expect(schedulerInstance.send).not.toHaveBeenCalled();
  });

  test('should handle missing event details', async () => {
    const event = {
      detail: {
        // Missing tenantId and senderId
        retryCount: 1,
        expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString()
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
    expect(schedulerInstance.send).not.toHaveBeenCalled();
  });

  test('should not schedule next check if it would exceed expiration', async () => {
    const event = {
      detail: {
        tenantId: 'tenant-123',
        senderId: 'sender-456',
        retryCount: 10,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes from now
      }
    };

    const mockSender = {
      senderId: 'sender-456',
      email: 'test@example.com',
      verificationStatus: 'pending',
      createdAt: new Date().toISOString()
    };

    ddbInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({ Item: mockSender });
      }
    });

    sesInstance.send.mockImplementation((command) => {
      if (command.__type === 'GetEmailIdentity') {
        return Promise.resolve({
          VerificationStatus: 'Pending',
          DkimAttributes: { Status: 'Pending' },
          IdentityType: 'EmailAddress'
        });
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(schedulerInstance.send).not.toHaveBeenCalled(); // Should not schedule next check

    const responseBody = JSON.parse(result.body);
    expect(responseBody.action).toBe('next_check_scheduled');
  });
});

describe('scheduleInitialStatusCheck', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/test-role';
    await loadIsolated();
  });

  test('should schedule initial status check', async () => {
    schedulerInstance.send.mockImplementation((command) => {
      if (command.__type === 'CreateSchedule') {
        return Promise.resolve({});
      }
    });

    await scheduleInitialStatusCheck('tenant-123', 'sender-456');

    expect(schedulerInstance.send).toHaveBeenCalledTimes(1);

    const scheduleCall = schedulerInstance.send.mock.calls[0][0];
    expect(scheduleCall.__type).toBe('CreateSchedule');
    expect(scheduleCall.GroupName).toBe('newsletter');
    expect(scheduleCall.ActionAfterCompletion).toBe('DELETE');

    // Verify the event details
    const inputData = JSON.parse(scheduleCall.Target.Input);
    const eventDetail = JSON.parse(inputData.Entries[0].Detail);
    expect(eventDetail.tenantId).toBe('tenant-123');
    expect(eventDetail.senderId).toBe('sender-456');
    expect(eventDetail.retryCount).toBe(0);
    expect(eventDetail.expiresAt).toBeDefined();
  });

  test('should handle scheduling errors', async () => {
    schedulerInstance.send.mockImplementation((command) => {
      if (command.__type === 'CreateSchedule') {
        return Promise.reject(new Error('Scheduler error'));
      }
    });

    await expect(scheduleInitialStatusCheck('tenant-123', 'sender-456')).rejects.toThrow('Scheduler error');
  });
});
