import { jest } from '@jest/globals';

// Mock instances
const sesInstance = { send: jest.fn() };
const schedulerInstance = { send: jest.fn() };
const ddbInstance = { send: jest.fn() };

// Mock AWS SDK
jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn(() => sesInstance),
  SendEmailCommand: jest.fn((params) => ({ __type: 'SendEmail', ...params })),
  ListContactsCommand: jest.fn((params) => ({ __type: 'ListContacts', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn(() => schedulerInstance),
  CreateScheduleCommand: jest.fn((params) => ({ __type: 'CreateSchedule', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ddbInstance),
  QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
  UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => ({ marshalled: obj })),
  unmarshall: jest.fn((obj) => obj.unmarshalled || obj)
}));

// Mock helpers
jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  encrypt: jest.fn((email) => `encrypted_${email}`)
}));

// Mock sender types
jest.unstable_mockModule('../functions/senders/types.mjs', () => ({
  KEY_PATTERNS: {
    SENDER: (senderId) => `sender#${senderId}`,
    SENDER_GSI1PK: (tenantId) => `sender#${tenantId}`
  }
}));

// Import after mocks
const { handler } = await import('../functions/send-email-v2.mjs');

describe('send-email-v2', () => {
  beforeAll(() => {
    // Set environment variables
    process.env.TABLE_NAME = 'test-table';
    process.env.CONFIGURATION_SET = 'test-config-set';
    process.env.SES_TPS_LIMIT = '5';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sender email validation', () => {
    test('uses provided from email when configured and verified', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          html: '<p>Test content</p>',
          to: { email: 'recipient@example.com' },
          from: 'sender@example.com',
          tenantId: 'tenant-123'
        }
      };

      // Mock sender lookup - found and verified
      ddbInstance.send.mockResolvedValueOnce({
        Items: [{
          unmarshalled: {
            senderId: 'sender-123',
            email: 'sender@example.com',
            verificationStatus: 'verified',
            isDefault: false
          }
        }]
      });

      // Mock SES send
      sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });

      // Mock metrics update
      ddbInstance.send.mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.sent).toBe(true);
      expect(result.senderEmail).toBe('sender@example.com');
      expect(result.senderId).toBe('sender-123');

      // Verify SES was called with correct from address
      const sesCall = sesInstance.send.mock.calls[0][0];
      expect(sesCall.FromEmailAddress).toBe('sender@example.com');
    });

    test('throws error when provided from email is not configured', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          html: '<p>Test content</p>',
          to: { email: 'recipient@example.com' },
          from: 'unconfigured@example.com',
          tenantId: 'tenant-123'
        }
      };

      // Mock sender lookup - not found
      ddbInstance.send.mockResolvedValueOnce({
        Items: []
      });

      await expect(handler(event)).rejects.toThrow(
        "From email 'unconfigured@example.com' is not configured for this tenant"
      );
    });

    test('throws error when provided from email is not verified', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          html: '<p>Test content</p>',
          to: { email: 'recipient@example.com' },
          from: 'pending@example.com',
          tenantId: 'tenant-123'
        }
      };

      // Mock sender lookup - found but not verified
      ddbInstance.send.mockResolvedValueOnce({
        Items: [{
          unmarshalled: {
            senderId: 'sender-123',
            email: 'pending@example.com',
            verificationStatus: 'pending',
            isDefault: false
          }
        }]
      });

      await expect(handler(event)).rejects.toThrow(
        "From email 'pending@example.com' is not verified"
      );
    });

    test('uses default sender when no from email provided', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          html: '<p>Test content</p>',
          to: { email: 'recipient@example.com' },
          tenantId: 'tenant-123'
        }
      };

      // Mock default sender lookup
      ddbInstance.send.mockResolvedValueOnce({
        Items: [{
          unmarshalled: {
            senderId: 'default-sender-123',
            email: 'default@example.com',
            verificationStatus: 'verified',
            isDefault: true
          }
        }]
      });

      // Mock SES send
      sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });

      // Mock metrics update
      ddbInstance.send.mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.sent).toBe(true);
      expect(result.senderEmail).toBe('default@example.com');
      expect(result.senderId).toBe('default-sender-123');

      // Verify SES was called with default sender
      const sesCall = sesInstance.send.mock.calls[0][0];
      expect(sesCall.FromEmailAddress).toBe('default@example.com');
    });

    test('throws error when no default sender configured', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          html: '<p>Test content</p>',
          to: { email: 'recipient@example.com' },
          tenantId: 'tenant-123'
        }
      };

      // Mock default sender lookup - not found
      ddbInstance.send.mockResolvedValueOnce({
        Items: []
      });

      await expect(handler(event)).rejects.toThrow(
        'No default sender configured for this tenant'
      );
    });

    test('throws error when tenantId is missing', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          html: '<p>Test content</p>',
          to: { email: 'recipient@example.com' }
        }
      };

      await expect(handler(event)).rejects.toThrow('Missing required field: tenantId');
    });
  });

  describe('metrics tracking', () => {
    test('updates sender metrics after successful send', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          html: '<p>Test content</p>',
          to: { email: 'recipient@example.com' },
          from: 'sender@example.com',
          tenantId: 'tenant-123'
        }
      };

      // Mock sender lookup
      ddbInstance.send.mockResolvedValueOnce({
        Items: [{
          unmarshalled: {
            senderId: 'sender-123',
            email: 'sender@example.com',
            verificationStatus: 'verified',
            isDefault: false
          }
        }]
      });

      // Mock SES send
      sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });

      // Mock metrics update
      ddbInstance.send.mockResolvedValueOnce({});

      await handler(event);

      // Verify metrics update was called
      expect(ddbInstance.send).toHaveBeenCalledTimes(2); // 1 for lookup, 1 for metrics
      const metricsCall = ddbInstance.send.mock.calls[1][0];
      expect(metricsCall.__type).toBe('UpdateItem');
      expect(metricsCall.UpdateExpression).toBe('ADD emailsSent :count SET lastSentAt = :timestamp');
    });

    test('continues even if metrics update fails', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          html: '<p>Test content</p>',
          to: { email: 'recipient@example.com' },
          from: 'sender@example.com',
          tenantId: 'tenant-123'
        }
      };

      // Mock sender lookup
      ddbInstance.send.mockResolvedValueOnce({
        Items: [{
          unmarshalled: {
            senderId: 'sender-123',
            email: 'sender@example.com',
            verificationStatus: 'verified',
            isDefault: false
          }
        }]
      });

      // Mock SES send
      sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });

      // Mock metrics update failure
      ddbInstance.send.mockRejectedValueOnce(new Error('DynamoDB error'));

      // Should not throw error despite metrics failure
      const result = await handler(event);
      expect(result.sent).toBe(true);
    });
  });

  describe('error handling', () => {
    test('handles DynamoDB query errors gracefully', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          html: '<p>Test content</p>',
          to: { email: 'recipient@example.com' },
          from: 'sender@example.com',
          tenantId: 'tenant-123'
        }
      };

      // Mock DynamoDB error
      ddbInstance.send.mockRejectedValue(new Error('DynamoDB connection failed'));

      await expect(handler(event)).rejects.toThrow('Failed to query sender email');
    });

    test('handles missing event detail', async () => {
      const event = {};

      await expect(handler(event)).rejects.toThrow('Missing event detail');
    });

    test('handles missing required fields', async () => {
      const event = {
        detail: {
          subject: 'Test Subject',
          tenantId: 'tenant-123'
          // Missing html and to
        }
      };

      await expect(handler(event)).rejects.toThrow('Missing required fields: subject, html, or to');
    });
  });
});
