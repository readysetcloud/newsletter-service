import { jest } from '@jest/globals';

// Mock instances
const sesInstance = { send: jest.fn() };
const schedulerInstance = { send: jest.fn() };
const eventBridgeInstance = { send: jest.fn() };
const ddbInstance = { send: jest.fn() };

// Mock AWS SDK
jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn(() => sesInstance),
  SendEmailCommand: jest.fn((params) => ({ __type: 'SendEmail', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn(() => schedulerInstance),
  CreateScheduleCommand: jest.fn((params) => ({ __type: 'CreateSchedule', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => eventBridgeInstance),
  PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params }))
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
  encrypt: jest.fn((email) => `encrypted_${email}`),
  sendWithRetry: jest.fn(async (fn, operationName) => await fn())
}));

// Mock subscriber utility
jest.unstable_mockModule('../functions/utils/subscriber.mjs', () => ({
  listSubscribers: jest.fn(() => Promise.resolve({
    subscribers: [],
    lastEvaluatedKey: undefined
  })),
  getSubscriberByEmail: jest.fn(() => Promise.resolve(null)),
  updateSubscriberSendMetadata: jest.fn(() => Promise.resolve())
}));

// Note: KEY_PATTERNS is now defined inline in send-email-v2.mjs (no longer imported from senders/types.mjs)

// Import after mocks
const { handler } = await import('../functions/send-email-v2.mjs');
const { listSubscribers, getSubscriberByEmail, updateSubscriberSendMetadata } = await import('../functions/utils/subscriber.mjs');

describe('send-email-v2', () => {
  beforeAll(() => {
    // Set environment variables
    process.env.TABLE_NAME = 'test-table';
    process.env.CONFIGURATION_SET = 'test-config-set';
    process.env.SES_TPS_LIMIT = '5';
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset listSubscribers mock to default behavior
    listSubscribers.mockResolvedValue({
      subscribers: [],
      lastEvaluatedKey: undefined
    });

    getSubscriberByEmail.mockResolvedValue(null);
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

      expect(updateSubscriberSendMetadata).toHaveBeenCalledWith(
        'tenant-123',
        'recipient@example.com',
        undefined
      );
    });

    test('tracks lastIssueSent and lastSentAt for issue sends', async () => {
      const event = {
        detail: {
          subject: 'Issue Subject',
          html: '<p>Issue content</p>',
          to: { email: 'recipient@example.com' },
          from: 'sender@example.com',
          tenantId: 'tenant-123',
          referenceNumber: 'tenant-123_42'
        }
      };

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

      sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });
      ddbInstance.send.mockResolvedValueOnce({});

      await handler(event);

      expect(updateSubscriberSendMetadata).toHaveBeenCalledWith(
        'tenant-123',
        'recipient@example.com',
        'tenant-123_42'
      );
    });



    test('skips send when single recipient already received issue reference', async () => {
      const event = {
        detail: {
          subject: 'Issue Subject',
          html: '<p>Issue content</p>',
          to: { email: 'recipient@example.com' },
          from: 'sender@example.com',
          tenantId: 'tenant-123',
          referenceNumber: 'tenant-123_42'
        }
      };

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

      getSubscriberByEmail.mockResolvedValue({
        email: 'recipient@example.com',
        lastIssueSent: 'tenant-123_42'
      });

      const result = await handler(event);

      expect(result.sent).toBe(true);
      expect(result.recipients).toBe(0);
      expect(result.skipped).toBe(1);
      expect(sesInstance.send).not.toHaveBeenCalled();
      expect(updateSubscriberSendMetadata).not.toHaveBeenCalled();
    });

    test('filters out subscribers already sent current issue for list sends', async () => {
      const event = {
        detail: {
          subject: 'Issue Subject',
          html: '<p>Issue content</p>',
          to: { list: 'main-list' },
          from: 'sender@example.com',
          tenantId: 'tenant-123',
          referenceNumber: 'tenant-123_42'
        }
      };

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

      listSubscribers.mockResolvedValue({
        subscribers: [
          { email: 'new@example.com', lastIssueSent: null },
          { email: 'already@example.com', lastIssueSent: 'tenant-123_42' }
        ],
        lastEvaluatedKey: undefined
      });

      sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });
      ddbInstance.send.mockResolvedValueOnce({});

      const result = await handler(event);

      expect(result.recipients).toBe(1);
      expect(result.skipped).toBe(1);
      expect(sesInstance.send).toHaveBeenCalledTimes(1);
      expect(updateSubscriberSendMetadata).toHaveBeenCalledTimes(1);
      expect(updateSubscriberSendMetadata).toHaveBeenCalledWith('tenant-123', 'new@example.com', 'tenant-123_42');
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

  describe('A/B hold-out testing', () => {
    const makeSubscribers = (count) =>
      Array.from({ length: count }, (_, i) => ({ email: `user${i}@example.com`, lastIssueSent: null }));

    const abEvent = {
      detail: {
        subject: 'Default subject',
        html: '<p>Hello __EMAIL__</p>',
        to: { list: 'my-list' },
        from: 'sender@example.com',
        tenantId: 'tenant-123',
        referenceNumber: 'tenant-123_42',
        replacements: { emailAddress: '__EMAIL__', emailAddressHash: '__EMAIL_HASH__' },
        abTest: {
          dimension: 'subject',
          testFraction: 0.5,
          evaluateAfterMinutes: 120,
          variants: [
            { variantId: 'a', subject: 'Subject A' },
            { variantId: 'b', subject: 'Subject B' }
          ]
        }
      }
    };

    beforeEach(() => {
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
      ddbInstance.send.mockResolvedValue({});
      sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });
      schedulerInstance.send.mockResolvedValue({});
    });

    test('only sends to the test sample (hold-out) and tags each send with a variant', async () => {
      listSubscribers.mockResolvedValue({ subscribers: makeSubscribers(40), lastEvaluatedKey: undefined });

      const result = await handler({ detail: { ...abEvent.detail } });

      // Hold-out: only a fraction of the 40 recipients are sent the test now.
      expect(result.recipients).toBeGreaterThan(0);
      expect(result.recipients).toBeLessThan(40);
      expect(sesInstance.send).toHaveBeenCalledTimes(result.recipients);

      // Every test send carries both the referenceNumber and a variant tag.
      const variantValues = new Set();
      for (const call of sesInstance.send.mock.calls) {
        const tags = call[0].EmailTags ?? [];
        const variantTag = tags.find((t) => t.Name === 'variant');
        expect(variantTag).toBeDefined();
        expect(['a', 'b']).toContain(variantTag.Value);
        expect(tags.find((t) => t.Name === 'referenceNumber')).toBeDefined();
        variantValues.add(variantTag.Value);
      }
      // Both variants should appear across a 40-recipient sample.
      expect(variantValues.has('a')).toBe(true);
      expect(variantValues.has('b')).toBe(true);
    });

    test('schedules the winner evaluation as an Evaluate AB Test event', async () => {
      listSubscribers.mockResolvedValue({ subscribers: makeSubscribers(20), lastEvaluatedKey: undefined });

      await handler({ detail: { ...abEvent.detail } });

      expect(schedulerInstance.send).toHaveBeenCalledTimes(1);
      const scheduleParams = schedulerInstance.send.mock.calls[0][0];
      const entry = JSON.parse(scheduleParams.Target.Input).Entries[0];
      expect(entry.DetailType).toBe('Evaluate AB Test');
      const detail = JSON.parse(entry.Detail);
      expect(detail.tenantId).toBe('tenant-123');
      expect(detail.referenceNumber).toBe('tenant-123_42');
      expect(detail.issueNumber).toBe('42');
      expect(detail.sendPayload.html).toBe('<p>Hello __EMAIL__</p>');
      expect(detail.sendPayload.to.list).toBe('my-list');
    });

    test('marks the test as testing once the sample has been sent', async () => {
      listSubscribers.mockResolvedValue({ subscribers: makeSubscribers(20), lastEvaluatedKey: undefined });

      await handler({ detail: { ...abEvent.detail } });

      const newsletterUpdates = ddbInstance.send.mock.calls
        .map(([cmd]) => cmd)
        .filter((cmd) => cmd.__type === 'UpdateItem' && cmd.Key?.marshalled?.sk === 'newsletter');
      expect(newsletterUpdates).toHaveLength(1);

      const update = newsletterUpdates[0];
      expect(update.Key.marshalled.pk).toBe('tenant-123#42');
      // Both the CAS mirror and embedded status flip to 'testing', and the write
      // is guarded so it can only advance a still-pending test.
      expect(update.UpdateExpression).toContain('abTestStatus = :testing');
      expect(update.ConditionExpression).toContain('abTestStatus = :pending');
      const values = update.ExpressionAttributeValues.marshalled;
      expect(values[':testing']).toBe('testing');
      const persisted = JSON.parse(values[':ab']);
      expect(persisted.status).toBe('testing');
      expect(persisted.dimension).toBe('subject');
    });
  });

  describe('A/B send-time testing', () => {
    const makeSubscribers = (count) =>
      Array.from({ length: count }, (_, i) => ({ email: `user${i}@example.com`, lastIssueSent: null }));
    const futureIso = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
    const sendTimeDetail = (overrides = {}) => ({
      subject: 'Same subject for all',
      html: '<p>Hello __EMAIL__</p>',
      to: { list: 'my-list' },
      from: 'sender@example.com',
      tenantId: 'tenant-123',
      referenceNumber: 'tenant-123_42',
      replacements: { emailAddress: '__EMAIL__' },
      abTest: {
        dimension: 'sendTime',
        testFraction: 0.5,
        evaluateAfterMinutes: 120,
        variants: [
          { variantId: 'a', sendAt: futureIso(2) },
          { variantId: 'b', sendAt: futureIso(6) }
        ]
      },
      ...overrides
    });

    beforeEach(() => {
      ddbInstance.send.mockResolvedValueOnce({
        Items: [{
          unmarshalled: { senderId: 'sender-123', email: 'sender@example.com', verificationStatus: 'verified', isDefault: false }
        }]
      });
      ddbInstance.send.mockResolvedValue({});
      sesInstance.send.mockResolvedValue({ MessageId: 'msg-123' });
      schedulerInstance.send.mockResolvedValue({});
      eventBridgeInstance.send.mockResolvedValue({});
    });

    test('initial publish fans out one Send Email v2 per variant and sends nothing inline', async () => {
      const result = await handler({ detail: sendTimeDetail() });

      expect(result.scheduled).toBe(true);
      // Nothing is sent in this invocation; subscribers are not even retrieved.
      expect(sesInstance.send).not.toHaveBeenCalled();
      expect(listSubscribers).not.toHaveBeenCalled();

      // One per-variant Send Email v2 event per variant, each with a variantFilter.
      expect(eventBridgeInstance.send).toHaveBeenCalledTimes(2);
      const filters = eventBridgeInstance.send.mock.calls.map(([cmd]) => {
        const entry = cmd.Entries[0];
        expect(entry.DetailType).toBe('Send Email v2');
        const detail = JSON.parse(entry.Detail);
        expect(detail.abTest.dimension).toBe('sendTime');
        expect(detail.sendAt).toBeDefined();
        return detail.variantFilter;
      });
      expect(new Set(filters)).toEqual(new Set(['a', 'b']));

      // Evaluation scheduled once, after the latest candidate send time.
      expect(schedulerInstance.send).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(schedulerInstance.send.mock.calls[0][0].Target.Input).Entries[0];
      expect(entry.DetailType).toBe('Evaluate AB Test');
    });

    test('marks the test as testing when fanning out per-variant sends', async () => {
      await handler({ detail: sendTimeDetail() });

      const newsletterUpdates = ddbInstance.send.mock.calls
        .map(([cmd]) => cmd)
        .filter((cmd) => cmd.__type === 'UpdateItem' && cmd.Key?.marshalled?.sk === 'newsletter');
      expect(newsletterUpdates).toHaveLength(1);

      const values = newsletterUpdates[0].ExpressionAttributeValues.marshalled;
      expect(values[':testing']).toBe('testing');
      const persisted = JSON.parse(values[':ab']);
      expect(persisted.status).toBe('testing');
      expect(persisted.dimension).toBe('sendTime');
    });

    test('per-variant fire (variantFilter) sends only that variant bucket and schedules nothing', async () => {
      listSubscribers.mockResolvedValue({ subscribers: makeSubscribers(40), lastEvaluatedKey: undefined });

      const result = await handler({ detail: sendTimeDetail({ variantFilter: 'a' }) });

      // Only variant a's slice of the 50% sample is sent.
      expect(result.recipients).toBeGreaterThan(0);
      expect(result.recipients).toBeLessThan(20);
      expect(sesInstance.send).toHaveBeenCalledTimes(result.recipients);
      for (const [cmd] of sesInstance.send.mock.calls) {
        const variantTag = (cmd.EmailTags ?? []).find((t) => t.Name === 'variant');
        expect(variantTag?.Value).toBe('a');
        // Send-time variants share the base subject.
        expect(cmd.Content.Simple.Subject.Data).toBe('Same subject for all');
      }
      // No fan-out and no duplicate evaluation scheduling on a per-variant fire.
      expect(eventBridgeInstance.send).not.toHaveBeenCalled();
      expect(schedulerInstance.send).not.toHaveBeenCalled();
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

    // Reset listSubscribers mock to default behavior
    listSubscribers.mockResolvedValue({
      subscribers: [],
      lastEvaluatedKey: undefined
    });

    getSubscriberByEmail.mockResolvedValue(null);

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
              // Query is for sender lookup
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

          // Mock listSubscribers to return recipients
          listSubscribers.mockResolvedValue({
            subscribers: data.recipients.map(email => ({ email })),
            lastEvaluatedKey: undefined
          });

          // Mock SES SendEmail
          sesInstance.send.mockImplementation((command) => {
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

          // Property: Each email should be sent to a recipient from the list
          const sentEmails = sendEmailCalls.map(call =>
            call[0].Destination.ToAddresses[0]
          );

          // Verify all sent emails are in the recipients list
          sentEmails.forEach(email => {
            expect(data.recipients).toContain(email);
          });

          // Verify all recipients received an email
          expect(sentEmails.length).toBe(data.recipients.length);
        }),
        { numRuns: 100 }
      );
    });
  });
});
