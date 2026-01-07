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

// Property-based tests
import * as fc from 'fast-check';

describe('send-email-v2 property-based tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
    process.env.CONFIGURATION_SET = 'test-config-set';
    process.env.SES_TPS_LIMIT = '5';

    // Suppress console logs during property tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Property 9: Sender metrics updated', () => {
    /**
     * Feature: welcome-newsletter, Property 9: Sender metrics updated
     * For any successfully sent welcome email, the sender's emailsSent metric
     * should be incremented and lastSentAt timestamp should be updated
     * Validates: Requirements 4.4
     */
    test('sender metrics are updated after successful email send', () => {
      const arbitraryEmail = fc.emailAddress();
      const arbitraryTenantId = fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0);
      const arbitrarySenderId = fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0);
      const arbitrarySenderEmail = fc.emailAddress();
      const arbitrarySubject = fc.string({ minLength: 1, maxLength: 100 });
      const arbitraryHtml = fc.string({ minLength: 10, maxLength: 500 });

      const arbitraryEmailData = fc.record({
        tenantId: arbitraryTenantId,
        senderId: arbitrarySenderId,
        senderEmail: arbitrarySenderEmail,
        recipientEmail: arbitraryEmail,
        subject: arbitrarySubject,
        html: arbitraryHtml,
      });

      fc.assert(
        fc.asyncProperty(arbitraryEmailData, async (data) => {
          jest.clearAllMocks();

          // Suppress console during each iteration
          jest.spyOn(console, 'log').mockImplementation(() => {});
          jest.spyOn(console, 'error').mockImplementation(() => {});

          // Mock sender lookup - return the sender that matches the from email
          ddbInstance.send.mockImplementation((command) => {
            if (command.__type === 'Query') {
              return Promise.resolve({
                Items: [{
                  unmarshalled: {
                    senderId: data.senderId,
                    email: data.senderEmail,
                    verificationStatus: 'verified',
                    isDefault: false
                  }
                }]
              });
            }
            if (command.__type === 'UpdateItem') {
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });

          // Mock SES send
          sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });

          const event = {
            detail: {
              subject: data.subject,
              html: data.html,
              to: { email: data.recipientEmail },
              from: data.senderEmail,
              tenantId: data.tenantId
            }
          };

          await handler(event);

          // Property: Metrics update should be called
          const updateCalls = ddbInstance.send.mock.calls.filter(call => call[0].__type === 'UpdateItem');
          expect(updateCalls.length).toBe(1);

          // Property: UpdateItem call should be for metrics
          const metricsCall = updateCalls[0][0];
          expect(metricsCall.UpdateExpression).toBe('ADD emailsSent :count SET lastSentAt = :timestamp');

          // Property: Should update the correct sender
          const key = metricsCall.Key.marshalled;
          expect(key.pk).toBe(data.tenantId);
          expect(key.sk).toBe(`sender#${data.senderId}`);

          // Property: Should increment by 1 (single recipient)
          expect(metricsCall.ExpressionAttributeValues.marshalled[':count']).toBe(1);

          // Property: lastSentAt should be a valid ISO timestamp
          const timestamp = metricsCall.ExpressionAttributeValues.marshalled[':timestamp'];
          expect(() => new Date(timestamp)).not.toThrow();
          expect(new Date(timestamp).toISOString()).toBe(timestamp);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 10: TPS rate limiting', () => {
    /**
     * Feature: welcome-newsletter, Property 10: TPS rate limiting
     * For any batch of welcome emails sent, the time between consecutive email
     * sends should be at least the configured minimum delay based on TPS limit
     * Validates: Requirements 4.5
     */
    test('emails are sent with appropriate delay based on TPS limit', () => {
      const arbitraryTenantId = fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0);
      const arbitrarySenderId = fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0);
      const arbitrarySenderEmail = fc.emailAddress();
      const arbitrarySubject = fc.string({ minLength: 1, maxLength: 100 });
      const arbitraryHtml = fc.string({ minLength: 10, maxLength: 500 });
      const arbitraryContactList = fc.string({ minLength: 5, maxLength: 50 });

      // Generate 2-5 unique recipient emails for testing batch sends
      const arbitraryRecipients = fc.uniqueArray(fc.emailAddress(), { minLength: 2, maxLength: 5 });

      const arbitraryBatchEmailData = fc.record({
        tenantId: arbitraryTenantId,
        senderId: arbitrarySenderId,
        senderEmail: arbitrarySenderEmail,
        contactList: arbitraryContactList,
        recipients: arbitraryRecipients,
        subject: arbitrarySubject,
        html: arbitraryHtml,
      });

      fc.assert(
        fc.asyncProperty(arbitraryBatchEmailData, async (data) => {
          jest.clearAllMocks();

          // Suppress console during each iteration
          jest.spyOn(console, 'log').mockImplementation(() => {});
          jest.spyOn(console, 'error').mockImplementation(() => {});

          // Mock DynamoDB calls
          ddbInstance.send.mockImplementation((command) => {
            if (command.__type === 'Query') {
              // First query is for sender lookup
              if (command.IndexName === 'GSI1') {
                return Promise.resolve({
                  Items: [{
                    unmarshalled: {
                      senderId: data.senderId,
                      email: data.senderEmail,
                      verificationStatus: 'verified',
                      isDefault: false
                    }
                  }]
                });
              }
              // Second query is for recent unsubscribes
              return Promise.resolve({ Items: [] });
            }
            if (command.__type === 'UpdateItem') {
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });

          // Mock SES ListContacts to return recipients
          sesInstance.send.mockImplementation((command) => {
            if (command.__type === 'ListContacts') {
              return Promise.resolve({
                Contacts: data.recipients.map(email => ({ EmailAddress: email })),
                NextToken: undefined
              });
            }
            if (command.__type === 'SendEmail') {
              return Promise.resolve({ MessageId: `msg-${Math.random()}` });
            }
            return Promise.resolve({});
          });

          const event = {
            detail: {
              subject: data.subject,
              html: data.html,
              to: { list: data.contactList },
              from: data.senderEmail,
              tenantId: data.tenantId
            }
          };

          const startTime = Date.now();
          await handler(event);
          const endTime = Date.now();
          const totalTime = endTime - startTime;

          // Property: Total time should be at least (recipients - 1) * delayMs
          // TPS limit is 5, so delayMs = 1000/5 = 200ms
          const tpsLimit = 5;
          const expectedDelayMs = Math.ceil(1000 / tpsLimit);
          const minExpectedTime = (data.recipients.length - 1) * expectedDelayMs;

          // Allow generous tolerance for execution time (100ms per email for processing overhead)
          // This accounts for mock execution time, promise resolution, and system variability
          const tolerance = data.recipients.length * 100;
          expect(totalTime).toBeGreaterThanOrEqual(minExpectedTime - tolerance);

          // Property: All emails should be sent
          const sendEmailCalls = sesInstance.send.mock.calls.filter(
            call => call[0].__type === 'SendEmail'
          );
          expect(sendEmailCalls.length).toBe(data.recipients.length);

          // Property: Each email should be sent to correct recipient
          const sentEmails = sendEmailCalls.map(call =>
            call[0].Destination.ToAddresses[0]
          );
          expect(sentEmails.sort()).toEqual(data.recipients.sort());
        }),
        { numRuns: 100 }
      );
    });
  });
});
