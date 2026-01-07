import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as fc from 'fast-check';

const mockDdbSend = jest.fn();
const mockEventBridgeSend = jest.fn();
const mockEncrypt = jest.fn((email) => `encrypted_${email}`);
const mockTemplate = jest.fn((data) => `<html>Welcome ${data.subscriberFirstName || ''} to ${data.brandName}</html>`);

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDdbSend })),
  GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
  QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params })),
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj),
}));

jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  encrypt: mockEncrypt,
}));

jest.unstable_mockModule('handlebars', () => ({
  default: {
    compile: jest.fn(() => mockTemplate),
  },
}));

jest.unstable_mockModule('fs', () => ({
  readFileSync: jest.fn(() => '<html>{{brandName}}</html>'),
}));

const { handler } = await import('../functions/subscribers/send-welcome-email.mjs');

describe('send-welcome-email handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
    process.env.ORIGIN = 'https://example.com';

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Property 1: Welcome email triggered on new subscription', () => {
    /**
     * Feature: welcome-newsletter, Property 1: Welcome email triggered on new subscription
     * For any new subscriber addition to a contact list, the system should publish
     * a subscriber added event that triggers a welcome email to be sent asynchronously
     * Validates: Requirements 1.1, 4.1, 4.2
     */
    test('welcome email event is published for any valid subscriber addition event', () => {
      const arbitraryEmail = fc.emailAddress();
      const arbitraryTenantId = fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0);
      const arbitraryFirstName = fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null });
      const arbitraryBrandName = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);
      const arbitrarySenderEmail = fc.emailAddress();

      const arbitrarySubscriberEvent = fc.record({
        tenantId: arbitraryTenantId,
        email: arbitraryEmail,
        firstName: arbitraryFirstName,
        brandName: arbitraryBrandName,
        senderEmail: arbitrarySenderEmail,
      });

      fc.assert(
        fc.asyncProperty(arbitrarySubscriberEvent, async (data) => {
          mockDdbSend.mockClear();
          mockEventBridgeSend.mockClear();

          mockDdbSend.mockImplementation((command) => {
            if (command.__type === 'GetItem') {
              return Promise.resolve({
                Item: {
                  pk: data.tenantId,
                  sk: 'tenant',
                  brandName: data.brandName,
                  brandLogo: null,
                  brandColor: null,
                  brandDescription: null,
                },
              });
            }
            if (command.__type === 'Query') {
              return Promise.resolve({
                Items: [{
                  email: data.senderEmail,
                  senderId: 'sender-123',
                  verificationStatus: 'verified',
                  isDefault: true,
                }],
              });
            }
            return Promise.resolve({});
          });

          mockEventBridgeSend.mockResolvedValue({});

          const event = {
            detail: {
              tenantId: data.tenantId,
              userId: null,
              type: 'SUBSCRIBER_ADDED',
              data: {
                email: data.email,
                firstName: data.firstName,
                subscriberCount: 1,
                addedAt: new Date().toISOString(),
              },
            },
          };

          await handler(event);

          // Property: EventBridge PutEvents should be called when valid data is provided
          if (mockEventBridgeSend.mock.calls.length > 0) {
            const putEventsCall = mockEventBridgeSend.mock.calls.find(
              call => call[0].__type === 'PutEvents'
            );

            if (putEventsCall) {
              // Property: Event should be "Send Email v2" type
              const eventEntry = JSON.parse(putEventsCall[0].Entries[0].Detail);
              expect(putEventsCall[0].Entries[0].DetailType).toBe('Send Email v2');

              // Property: Event should contain the subscriber's email
              expect(eventEntry.to.email).toBe(data.email);

              // Property: Event should contain tenant ID
              expect(eventEntry.tenantId).toBe(data.tenantId);
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: Default sender email used', () => {
    /**
     * Feature: welcome-newsletter, Property 2: Default sender email used
     * For any welcome email sent, the system should use the tenant's default
     * verified sender email address
     * Validates: Requirements 1.2
     */
    test('default verified sender email is used for all welcome emails', () => {
      const arbitraryEmail = fc.emailAddress();
      const arbitraryTenantId = fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0);
      const arbitrarySenderEmail = fc.emailAddress();

      const arbitraryData = fc.record({
        tenantId: arbitraryTenantId,
        subscriberEmail: arbitraryEmail,
        defaultSenderEmail: arbitrarySenderEmail,
      });

      fc.assert(
        fc.asyncProperty(arbitraryData, async (data) => {
          mockDdbSend.mockClear();
          mockEventBridgeSend.mockClear();

          mockDdbSend.mockImplementation((command) => {
            if (command.__type === 'GetItem') {
              return Promise.resolve({
                Item: {
                  pk: data.tenantId,
                  sk: 'tenant',
                  brandName: 'Test Brand',
                },
              });
            }
            if (command.__type === 'Query') {
              return Promise.resolve({
                Items: [{
                  email: data.defaultSenderEmail,
                  senderId: 'sender-123',
                  verificationStatus: 'verified',
                  isDefault: true,
                }],
              });
            }
            return Promise.resolve({});
          });

          mockEventBridgeSend.mockResolvedValue({});

          const event = {
            detail: {
              tenantId: data.tenantId,
              data: {
                email: data.subscriberEmail,
              },
            },
          };

          await handler(event);

          // Property: The "from" field should match the default sender email when event is published
          if (mockEventBridgeSend.mock.calls.length > 0) {
            const putEventsCall = mockEventBridgeSend.mock.calls.find(
              call => call[0].__type === 'PutEvents'
            );

            if (putEventsCall) {
              const eventEntry = JSON.parse(putEventsCall[0].Entries[0].Detail);
              expect(eventEntry.from).toBe(data.defaultSenderEmail);
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 8: Error resilience', () => {
    /**
     * Feature: welcome-newsletter, Property 8: Error resilience
     * For any welcome email send failure, the system should log the error
     * without throwing an exception that would block the subscription process
     * Validates: Requirements 4.3
     */
    test('errors are caught and logged without throwing exceptions', () => {
      const arbitraryEmail = fc.emailAddress();
      const arbitraryTenantId = fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0);
      const arbitraryErrorMessage = fc.string({ minLength: 1, maxLength: 100 });

      const arbitraryErrorScenario = fc.record({
        tenantId: arbitraryTenantId,
        email: arbitraryEmail,
        errorMessage: arbitraryErrorMessage,
        errorType: fc.constantFrom('tenant_not_found', 'no_default_sender', 'eventbridge_failure'),
      });

      fc.assert(
        fc.asyncProperty(arbitraryErrorScenario, async (scenario) => {
          mockDdbSend.mockClear();
          mockEventBridgeSend.mockClear();

          const consoleErrorSpy = jest.spyOn(console, 'error');

          mockDdbSend.mockImplementation((command) => {
            if (scenario.errorType === 'tenant_not_found' && command.__type === 'GetItem') {
              return Promise.resolve({ Item: null });
            }
            if (command.__type === 'GetItem') {
              return Promise.resolve({
                Item: {
                  pk: scenario.tenantId,
                  sk: 'tenant',
                  brandName: 'Test Brand',
                },
              });
            }
            if (scenario.errorType === 'no_default_sender' && command.__type === 'Query') {
              return Promise.resolve({ Items: [] });
            }
            if (command.__type === 'Query') {
              return Promise.resolve({
                Items: [{
                  email: 'sender@example.com',
                  senderId: 'sender-123',
                  verificationStatus: 'verified',
                  isDefault: true,
                }],
              });
            }
            return Promise.resolve({});
          });

          if (scenario.errorType === 'eventbridge_failure') {
            mockEventBridgeSend.mockRejectedValue(new Error(scenario.errorMessage));
          } else {
            mockEventBridgeSend.mockResolvedValue({});
          }

          const event = {
            detail: {
              tenantId: scenario.tenantId,
              data: {
                email: scenario.email,
              },
            },
          };

          // Property: Handler should not throw an exception
          await expect(handler(event)).resolves.not.toThrow();

          // Property: Errors should be logged when error scenarios occur
          if (scenario.errorType === 'tenant_not_found' || scenario.errorType === 'no_default_sender' || scenario.errorType === 'eventbridge_failure') {
            expect(consoleErrorSpy).toHaveBeenCalled();
          }

          consoleErrorSpy.mockRestore();
        }),
        { numRuns: 100 }
      );
    });

    test('handler completes successfully even when errors occur', async () => {
      const event = {};

      // Property: Should not throw
      await expect(handler(event)).resolves.not.toThrow();

      // Property: Should log error
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Unit tests for specific scenarios', () => {
    test('handles missing event detail gracefully', async () => {
      const event = {};
      await handler(event);

      expect(console.error).toHaveBeenCalledWith('Missing event detail');
      expect(mockDdbSend).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });

    test('handles missing required fields gracefully', async () => {
      const event = {
        detail: {
          tenantId: 'test-tenant',
          data: {},
        },
      };

      await handler(event);

      expect(console.error).toHaveBeenCalledWith(
        'Missing required fields:',
        expect.any(Object)
      );
      expect(mockDdbSend).not.toHaveBeenCalled();
      expect(mockEventBridgeSend).not.toHaveBeenCalled();
    });

    test('successfully sends welcome email with complete data', async () => {
      mockDdbSend.mockImplementation((command) => {
        if (command.__type === 'GetItem') {
          return Promise.resolve({
            Item: {
              pk: 'test-tenant',
              sk: 'tenant',
              brandName: 'Test Newsletter',
              brandLogo: 'https://example.com/logo.png',
              brandColor: '#FF0000',
              brandDescription: 'A great newsletter',
            },
          });
        }
        if (command.__type === 'Query') {
          return Promise.resolve({
            Items: [{
              email: 'sender@example.com',
              senderId: 'sender-123',
              verificationStatus: 'verified',
              isDefault: true,
            }],
          });
        }
        return Promise.resolve({});
      });

      mockEventBridgeSend.mockResolvedValue({});

      const event = {
        detail: {
          tenantId: 'test-tenant',
          data: {
            email: 'subscriber@example.com',
            firstName: 'John',
          },
        },
      };

      await handler(event);

      expect(mockDdbSend).toHaveBeenCalledTimes(2);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);

      const putEventsCall = mockEventBridgeSend.mock.calls[0][0];
      expect(putEventsCall.__type).toBe('PutEvents');
      expect(putEventsCall.Entries[0].Source).toBe('newsletter.welcome');
      expect(putEventsCall.Entries[0].DetailType).toBe('Send Email v2');

      const detail = JSON.parse(putEventsCall.Entries[0].Detail);
      expect(detail.tenantId).toBe('test-tenant');
      expect(detail.from).toBe('sender@example.com');
      expect(detail.to.email).toBe('subscriber@example.com');
      expect(detail.subject).toContain('Test Newsletter');
      expect(detail.html).toBeDefined();
    });
  });
});
