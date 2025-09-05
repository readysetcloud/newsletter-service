/**
 * @fileoverview Tests for EventBridge Stripe payment event handler
 */

import { jest } from '@jest/globals';

// Mock dependencies
const mockDynamoClient = {
  send: jest.fn()
};

const mockEventBridgeClient = {
  send: jest.fn()
};

const mockUpdateTenantUserGroupsByPriceId = jest.fn();
const mockGetSubscriptionRecord = jest.fn();
const mockAtomicSubscriptionUpdate = jest.fn();
const mockPublishMetricEvent = jest.fn();

// Mock command constructors
const mockQueryCommand = jest.fn();
const mockPutEventsCommand = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => mockDynamoClient),
  QueryCommand: mockQueryCommand,
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => mockEventBridgeClient),
  PutEventsCommand: mockPutEventsCommand
}));

jest.unstable_mockModule('../functions/billing/manage-user-groups.mjs', () => ({
  updateTenantUserGroupsByPriceId: mockUpdateTenantUserGroupsByPriceId
}));

jest.unstable_mockModule('../functions/billing/subscription-data.mjs', () => ({
  getSubscriptionRecord: mockGetSubscriptionRecord,
  atomicSubscriptionUpdate: mockAtomicSubscriptionUpdate
}));

jest.unstable_mockModule('../functions/billing/types.mjs', () => ({
  getPlanByPriceId: jest.fn((priceId) => {
    const plans = {
      'price_creator_monthly': 'creator',
      'price_pro_monthly': 'pro'
    };
    return plans[priceId] || null;
  }),
  SUBSCRIPTION_PLANS: {
    free: { name: 'Free', priceId: null, cognitoGroup: 'free-tier' },
    creator: { name: 'Creator', priceId: 'price_creator_monthly', cognitoGroup: 'creator-tier' },
    pro: { name: 'Pro', priceId: 'price_pro_monthly', cognitoGroup: 'pro-tier' }
  }
}));

jest.unstable_mockModule('../functions/utils/cloudwatch-metrics.mjs', () => ({
  publishMetricEvent: mockPublishMetricEvent
}));

// Import the handler after mocking
const { handler } = await import('../functions/billing/stripe-payment-events.mjs');

// Test data
const mockTenant = {
  tenantId: 'tenant-123',
  stripeCustomerId: 'cus_test123',
  userId: 'user-456'
};

const mockSubscriptionRecord = {
  pk: 'tenant-123',
  sk: 'subscription',
  stripeSubscriptionId: 'sub_test123',
  stripeCustomerId: 'cus_test123',
  status: 'active',
  planId: 'creator',
  currentPeriodEnd: '2024-02-01T00:00:00.000Z',
  cancelAtPeriodEnd: false
};

const mockSuccessfulInvoice = {
  id: 'in_test123',
  customer: 'cus_test123',
  subscription: 'sub_test123',
  amount_paid: 2900, // $29.00 in cents
  currency: 'usd',
  status_transitions: {
    paid_at: 1704067200 // 2024-01-01
  }
};

const mockFailedInvoice = {
  id: 'in_test456',
  customer: 'cus_test123',
  subscription: 'sub_test123',
  attempt_count: 1,
  next_payment_attempt: 1704153600 // 2024-01-02
};

describe('Stripe Payment EventBridge Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';

    // Default mock implementations
    mockDynamoClient.send.mockResolvedValue({
      Items: [mockTenant]
    });
    mockEventBridgeClient.send.mockResolvedValue({});
    mockUpdateTenantUserGroupsByPriceId.mockResolvedValue({});
    mockAtomicSubscriptionUpdate.mockResolvedValue({});
    mockGetSubscriptionRecord.mockResolvedValue(mockSubscriptionRecord);
    mockPublishMetricEvent.mockResolvedValue();
  });

  describe('Payment Succeeded Events', () => {
    test('should process payment_succeeded event successfully', async () => {
      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: mockSuccessfulInvoice
      };

      await handler(event);

      // Verify tenant lookup
      expect(mockDynamoClient.send).toHaveBeenCalled();

      // Verify subscription record update
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'active',
          lastPaymentAmount: 2900,
          lastPaymentCurrency: 'usd',
          lastPaymentEventId: 'event-123'
        }),
        'event-123'
      );

      // Verify user notification sent
      expect(mockEventBridgeClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Entries: expect.arrayContaining([
              expect.objectContaining({
                Source: 'newsletter.billing',
                DetailType: 'User Notification',
                Detail: expect.stringContaining('PAYMENT_SUCCEEDED')
              })
            ])
          })
        })
      );

      // Verify success metric published
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({
          dimensions: expect.objectContaining({
            TenantId: 'tenant-123',
            Amount: '2900',
            Currency: 'USD'
          })
        }),
        'event-123'
      );
    });

    test('should restore user groups when subscription was inactive', async () => {
      // Mock past_due subscription
      mockGetSubscriptionRecord.mockResolvedValue({
        ...mockSubscriptionRecord,
        status: 'past_due'
      });

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: mockSuccessfulInvoice
      };

      await handler(event);

      // Verify user groups restored
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123',
        null,
        'price_creator_monthly'
      );

      // Verify subscription updated with restoration flag
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'active',
          pastDueCleared: true,
          pastDueClearedAt: expect.any(String)
        }),
        'event-123'
      );
    });

    test('should skip processing if invoice not associated with subscription', async () => {
      const invoiceWithoutSubscription = {
        ...mockSuccessfulInvoice,
        subscription: null
      };

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: invoiceWithoutSubscription
      };

      await handler(event);

      // Should not update subscription or send notifications
      expect(mockAtomicSubscriptionUpdate).not.toHaveBeenCalled();
      expect(mockEventBridgeClient.send).not.toHaveBeenCalled();
    });

    test('should handle idempotent processing', async () => {
      // Mock subscription with same event ID already processed
      mockGetSubscriptionRecord.mockResolvedValue({
        ...mockSubscriptionRecord,
        lastPaymentEventId: 'event-123'
      });

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: mockSuccessfulInvoice
      };

      await handler(event);

      // Should skip processing
      expect(mockAtomicSubscriptionUpdate).not.toHaveBeenCalled();
      expect(mockEventBridgeClient.send).not.toHaveBeenCalled();
    });
  });

  describe('Payment Failed Events', () => {
    test('should process payment_failed event successfully', async () => {
      const event = {
        id: 'event-456',
        source: 'stripe',
        'detail-type': 'invoice.payment_failed',
        detail: mockFailedInvoice
      };

      await handler(event);

      // Verify subscription status updated to past_due
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'past_due',
          paymentAttemptCount: 1,
          lastPaymentEventId: 'event-456'
        }),
        'event-456'
      );

      // Verify failure notification sent
      expect(mockEventBridgeClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Entries: expect.arrayContaining([
              expect.objectContaining({
                Source: 'newsletter.billing',
                DetailType: 'User Notification',
                Detail: expect.stringContaining('PAYMENT_FAILED')
              })
            ])
          })
        })
      );

      // Verify failure metric published
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'payment.failed',
        expect.objectContaining({
          dimensions: expect.objectContaining({
            TenantId: 'tenant-123',
            AttemptCount: '1',
            IsFirstFailure: 'true',
            IsFinalFailure: 'false'
          })
        }),
        'event-456'
      );
    });

    test('should handle final payment failure (4th attempt)', async () => {
      const finalFailureInvoice = {
        ...mockFailedInvoice,
        attempt_count: 4,
        next_payment_attempt: null
      };

      const event = {
        id: 'event-456',
        source: 'stripe',
        'detail-type': 'invoice.payment_failed',
        detail: finalFailureInvoice
      };

      await handler(event);

      // Verify final failure notification sent
      expect(mockEventBridgeClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Entries: expect.arrayContaining([
              expect.objectContaining({
                Detail: expect.stringContaining('PAYMENT_FINAL_FAILURE')
              })
            ])
          })
        })
      );

      // Verify final failure metric
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'payment.failed',
        expect.objectContaining({
          dimensions: expect.objectContaining({
            IsFinalFailure: 'true'
          })
        }),
        'event-456'
      );
    });

    test('should handle second payment failure with retry notification', async () => {
      const retryFailureInvoice = {
        ...mockFailedInvoice,
        attempt_count: 2
      };

      const event = {
        id: 'event-456',
        source: 'stripe',
        'detail-type': 'invoice.payment_failed',
        detail: retryFailureInvoice
      };

      await handler(event);

      // Verify retry failure notification sent
      expect(mockEventBridgeClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Entries: expect.arrayContaining([
              expect.objectContaining({
                Detail: expect.stringContaining('PAYMENT_RETRY_FAILED')
              })
            ])
          })
        })
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle missing tenant', async () => {
      mockDynamoClient.send.mockResolvedValue({ Items: [] });

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: mockSuccessfulInvoice
      };

      await expect(handler(event)).rejects.toThrow('No tenant found for customer ID: cus_test123');
    });

    test('should handle missing subscription record', async () => {
      mockGetSubscriptionRecord.mockResolvedValue(null);

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: mockSuccessfulInvoice
      };

      await expect(handler(event)).rejects.toThrow('No subscription record found for tenant tenant-123');
    });

    test('should handle invalid event source', async () => {
      const event = {
        id: 'event-123',
        source: 'not-stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: mockSuccessfulInvoice
      };

      await expect(handler(event)).rejects.toThrow('Unexpected event source: not-stripe');
    });

    test('should handle unhandled event types', async () => {
      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.unknown_event',
        detail: mockSuccessfulInvoice
      };

      await handler(event);

      // Should not process anything
      expect(mockAtomicSubscriptionUpdate).not.toHaveBeenCalled();
      expect(mockEventBridgeClient.send).not.toHaveBeenCalled();
    });

    test('should publish error metrics on failure', async () => {
      mockAtomicSubscriptionUpdate.mockRejectedValue(new Error('Database error'));

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: mockSuccessfulInvoice
      };

      await expect(handler(event)).rejects.toThrow('Database error');

      // Verify error metric published
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'event.failed',
        expect.objectContaining({
          dimensions: expect.objectContaining({
            EventType: 'invoice.payment_succeeded',
            ErrorType: 'Error'
          })
        }),
        'event-123'
      );
    });
  });

  describe('Notification Handling', () => {
    test('should continue processing even if notification fails', async () => {
      mockEventBridgeClient.send.mockRejectedValue(new Error('EventBridge error'));

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: mockSuccessfulInvoice
      };

      // Should not throw error
      await handler(event);

      // Should still update subscription
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalled();

      // Should still publish success metrics
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.any(Object),
        'event-123'
      );
    });

    test('should continue processing even if user group update fails', async () => {
      mockUpdateTenantUserGroupsByPriceId.mockRejectedValue(new Error('Cognito error'));

      // Mock past_due subscription to trigger group update
      mockGetSubscriptionRecord.mockResolvedValue({
        ...mockSubscriptionRecord,
        status: 'past_due'
      });

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        detail: mockSuccessfulInvoice
      };

      // Should not throw error
      await handler(event);

      // Should still update subscription
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalled();

      // Should still send notification
      expect(mockEventBridgeClient.send).toHaveBeenCalled();
    });
  });
});
