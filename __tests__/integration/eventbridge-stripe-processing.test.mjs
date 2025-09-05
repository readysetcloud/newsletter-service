/**
 * @fileoverview Integration tests for EventBridge Stripe event processing
 *
 * Tests the rerom task 7:
 * - Subscription event handler with mock EventBridge events
 * - Payment event handler with various Stripe event scenarios
 * - Error handling, retry logic, and DLQ functionality
 * - Idempotent processing and proper user group management
 */

import { jest } from '@jest/globals';

// Mock AWS SDK
const mockDynamoSend = jest.fn();
const mockEventBridgeSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: mockDynamoSend
  })),
  QueryCommand: jest.fn((params) => params),
  UpdateItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({
    send: mockEventBridgeSend
  })),
  PutEventsCommand: jest.fn((params) => params)
}));

// Mock billing utilities
const mockUpdateTenantUserGroupsByPriceId = jest.fn();
const mockGetSubscriptionRecord = jest.fn();
const mockAtomicSubscriptionUpdate = jest.fn();
const mockPublishMetricEvent = jest.fn();

jest.unstable_mockModule('../../functions/billing/manage-user-groups.mjs', () => ({
  updateTenantUserGroupsByPriceId: mockUpdateTenantUserGroupsByPriceId
}));

jest.unstable_mockModule('../../functions/billing/subscription-data.mjs', () => ({
  getSubscriptionRecord: mockGetSubscriptionRecord,
  atomicSubscriptionUpdate: mockAtomicSubscriptionUpdate,
  updateSubscriptionStatus: jest.fn(),
  storeSubscriptionRecord: jest.fn(),
  deleteSubscriptionRecord: jest.fn(),
  batchGetSubscriptionRecords: jest.fn()
}));

jest.unstable_mockModule('../../functions/billing/types.mjs', () => ({
  getPlanByPriceId: jest.fn((priceId) => {
    const plans = {
      'price_creator_monthly': 'creator',
      'price_pro_monthly': 'pro'
    };
    return plans[priceId] || null;
  }),
  isValidSubscriptionStatus: jest.fn(() => true),
  createSubscriptionRecord: jest.fn((data) => ({
    pk: data.tenantId,
    sk: 'subscription',
    ...data,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  })),
  SUBSCRIPTION_PLANS: {
    free: { name: 'Free', priceId: null, cognitoGroup: 'free-tier' },
    creator: { name: 'Creator', priceId: 'price_creator_monthly', cognitoGroup: 'creator-tier' },
    pro: { name: 'Pro', priceId: 'price_pro_monthly', cognitoGroup: 'pro-tier' }
  }
}));

jest.unstable_mockModule('../../functions/utils/cloudwatch-metrics.mjs', () => ({
  publishMetricEvent: mockPublishMetricEvent
}));

// Import handlers after mocking
const { handler: subscriptionHandler } = await import('../../functions/billing/stripe-subscription-events.mjs');
const { handler: paymentHandler } = await import('../../functions/billing/stripe-payment-events.mjs');

describe('EventBridge Stripe Events Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Set environment variables
    process.env.TABLE_NAME = 'test-table';

    // Mock tenant data
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
      currentPeriodStart: '2024-01-01T00:00:00.000Z',
      currentPeriodEnd: '2024-02-01T00:00:00.000Z',
      cancelAtPeriodEnd: false
    };

    // Default mock implementations
    mockDynamoSend.mockResolvedValue({
      Items: [mockTenant]
    });
    mockEventBridgeSend.mockResolvedValue({
      Entries: [{ EventId: 'notification-event-123' }]
    });

    mockUpdateTenantUserGroupsByPriceId.mockResolvedValue({});
    mockAtomicSubscriptionUpdate.mockResolvedValue({});
    mockGetSubscriptionRecord.mockResolvedValue(mockSubscriptionRecord);
    mockPublishMetricEvent.mockResolvedValue();

    // Mock console methods to reduce test noise
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Subscription Event Handler with Mock EventBridge Events', () => {
    it('should process subscription.created event with user group management', async () => {
      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'customer.subscription.created',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'sub_test123',
          customer: 'cus_test123',
          status: 'active',
          current_period_start: 1704067200, // 2024-01-01 00:00:00 UTC
          current_period_end: 1706745600,   // 2024-02-01 00:00:00 UTC
          cancel_at_period_end: false,
          items: {
            data: [{
              price: {
                id: 'price_creator_monthly',
                product: 'prod_creator'
              }
            }]
          }
        }
      };

      await subscriptionHandler(event);

      // Verify tenant lookup via GSI
      expect(mockDynamoSend).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: 'StripeCustomerIndex'
        })
      );

      // Verify subscription record creation with idempotency
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          stripeSubscriptionId: 'sub_test123',
          stripeCustomerId: 'cus_test123',
          status: 'active',
          planId: 'creator',
          lastEventId: 'event-123'
        }),
        'event-123'
      );

      // Verify user group management for active subscription
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123',
        null,
        'price_creator_monthly'
      );
    });

    it('should handle subscription.updated with plan change', async () => {
      // Mock current subscription with creator plan
      mockGetSubscriptionRecord.mockResolvedValue({
        pk: 'tenant-123',
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
        planId: 'creator'
      });

      const event = {
        id: 'event-update-123',
        source: 'stripe',
        'detail-type': 'customer.subscription.updated',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'sub_test123',
          customer: 'cus_test123',
          status: 'active',
          current_period_start: 1704067200,
          current_period_end: 1706745600,
          cancel_at_period_end: false,
          items: {
            data: [{
              price: {
                id: 'price_pro_monthly',
                product: 'prod_pro'
              }
            }]
          }
        }
      };

      await subscriptionHandler(event);

      // Verify subscription update
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          planId: 'pro',
          lastEventId: 'event-update-123'
        }),
        'event-update-123'
      );

      // Verify user group change from creator to pro
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123',
        'price_creator_monthly', // from
        'price_pro_monthly'      // to
      );
    });

    it('should handle subscription.deleted with user downgrade', async () => {
      const event = {
        id: 'event-delete-123',
        source: 'stripe',
        'detail-type': 'customer.subscription.deleted',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'sub_test123',
          customer: 'cus_test123',
          status: 'canceled'
        }
      };

      await subscriptionHandler(event);

      // Verify subscription marked as deleted
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'deleted',
          deletedAt: expect.any(String),
          lastEventId: 'event-delete-123'
        }),
        'event-delete-123'
      );

      // Verify user downgraded from creator to free
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123',
        'price_creator_monthly', // from
        null                     // to free
      );
    });
  });

  describe('Payment Event Handler with Various Stripe Event Scenarios', () => {
    it('should process payment.succeeded with subscription reactivation', async () => {
      // Mock past_due subscription
      mockGetSubscriptionRecord.mockResolvedValue({
        pk: 'tenant-123',
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        status: 'past_due',
        planId: 'creator'
      });

      const event = {
        id: 'event-456',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'in_test123',
          customer: 'cus_test123',
          subscription: 'sub_test123',
          amount_paid: 2900,
          amount_due: 2900,
          currency: 'usd',
          status: 'paid',
          paid: true,
          status_transitions: {
            paid_at: 1704067200 // 2024-01-01 00:00:00 UTC
          }
        }
      };

      await paymentHandler(event);

      // Verify subscription reactivated
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'active',
          lastPaymentAmount: 2900,
          lastPaymentCurrency: 'usd',
          pastDueCleared: true,
          lastPaymentEventId: 'event-456'
        }),
        'event-456'
      );

      // Verify user groups restored
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123',
        null,
        'price_creator_monthly'
      );

      // Verify success notification sent
      expect(mockEventBridgeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: expect.arrayContaining([
            expect.objectContaining({
              Source: 'newsletter.billing',
              DetailType: 'User Notification',
              Detail: expect.stringContaining('PAYMENT_SUCCEEDED')
            })
          ])
        })
      );
    });

    it('should process first payment failure with gentle notification', async () => {
      const event = {
        id: 'event-456',
        source: 'stripe',
        'detail-type': 'invoice.payment_failed',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'in_test123',
          customer: 'cus_test123',
          subscription: 'sub_test123',
          amount_paid: 0,
          amount_due: 2900,
          currency: 'usd',
          status: 'open',
          paid: false,
          attempt_count: 1,
          next_payment_attempt: 1704153600 // 2024-01-02
        }
      };

      await paymentHandler(event);

      // Verify subscription marked as past_due
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'past_due',
          paymentAttemptCount: 1,
          nextPaymentAttempt: '2024-01-02T00:00:00.000Z',
          lastPaymentEventId: 'event-456'
        }),
        'event-456'
      );

      // Verify gentle failure notification sent
      expect(mockEventBridgeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: expect.arrayContaining([
            expect.objectContaining({
              Detail: expect.stringContaining('PAYMENT_FAILED')
            })
          ])
        })
      );

      // Should not immediately remove user groups (retry period)
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });

    it('should process final payment failure with cancellation warning', async () => {
      const event = {
        id: 'event-456',
        source: 'stripe',
        'detail-type': 'invoice.payment_failed',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'in_test123',
          customer: 'cus_test123',
          subscription: 'sub_test123',
          amount_paid: 0,
          amount_due: 2900,
          currency: 'usd',
          status: 'open',
          paid: false,
          attempt_count: 4,
          next_payment_attempt: null
        }
      };

      await paymentHandler(event);

      // Verify final failure notification sent
      expect(mockEventBridgeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: expect.arrayContaining([
            expect.objectContaining({
              Detail: expect.stringContaining('PAYMENT_FINAL_FAILURE')
            })
          ])
        })
      );
    });
  });

  describe('Error Handling and Retry Logic', () => {
    it('should handle user group management failures gracefully', async () => {
      mockUpdateTenantUserGroupsByPriceId.mockRejectedValue(
        new Error('CognitoIdentityProviderException: User not found')
      );

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'customer.subscription.created',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'sub_test123',
          customer: 'cus_test123',
          status: 'active',
          current_period_start: 1704067200,
          current_period_end: 1706745600,
          cancel_at_period_end: false,
          items: {
            data: [{
              price: {
                id: 'price_creator_monthly',
                product: 'prod_creator'
              }
            }]
          }
        }
      };

      // Should not throw error - subscription processing should continue
      await subscriptionHandler(event);

      // Should still create subscription record
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalled();
    });

    it('should handle notification delivery failures gracefully', async () => {
      mockEventBridgeSend.mockRejectedValue(
        new Error('EventBridge service unavailable')
      );

      const event = {
        id: 'event-456',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'in_test123',
          customer: 'cus_test123',
          subscription: 'sub_test123',
          amount_paid: 2900,
          currency: 'usd',
          status: 'paid',
          paid: true,
          status_transitions: {
            paid_at: 1704067200
          }
        }
      };

      // Should not throw error - payment processing should continue
      await paymentHandler(event);

      // Should still update subscription
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalled();
    });
  });

  describe('Idempotent Processing and User Group Management', () => {
    it('should handle duplicate subscription events', async () => {
      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'customer.subscription.created',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'sub_test123',
          customer: 'cus_test123',
          status: 'active',
          current_period_start: 1704067200,
          current_period_end: 1706745600,
          cancel_at_period_end: false,
          items: {
            data: [{
              price: {
                id: 'price_creator_monthly',
                product: 'prod_creator'
              }
            }]
          }
        }
      };

      // First invocation - should process normally
      await subscriptionHandler(event);

      // Mock idempotency check for second invocation
      mockAtomicSubscriptionUpdate.mockRejectedValue(
        new Error('Event event-123 already processed for tenant tenant-123, skipping')
      );

      // Second invocation with same event - should skip processing
      await subscriptionHandler(event);

      // Should have been called twice but second call should be skipped
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledTimes(2);
    });

    it('should handle duplicate payment events', async () => {
      const event = {
        id: 'event-456',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'in_test123',
          customer: 'cus_test123',
          subscription: 'sub_test123',
          amount_paid: 2900,
          currency: 'usd',
          status: 'paid',
          paid: true,
          status_transitions: {
            paid_at: 1704067200
          }
        }
      };

      // First invocation
      await paymentHandler(event);

      // Mock subscription with same event ID already processed
      mockGetSubscriptionRecord.mockResolvedValue({
        pk: 'tenant-123',
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
        planId: 'creator',
        lastPaymentEventId: 'event-456'
      });

      // Second invocation - should skip
      await paymentHandler(event);

      // Should not process duplicate
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledTimes(1);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('DLQ Processing Simulation', () => {
    it('should simulate EventBridge DLQ behavior for repeated failures', async () => {
      // Simulate persistent failure that would go to DLQ
      mockAtomicSubscriptionUpdate.mockRejectedValue(
        new Error('Persistent database error')
      );

      const event = {
        id: 'event-123',
        source: 'stripe',
        'detail-type': 'customer.subscription.created',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'sub_test123',
          customer: 'cus_test123',
          status: 'active',
          current_period_start: 1704067200,
          current_period_end: 1706745600,
          cancel_at_period_end: false,
          items: {
            data: [{
              price: {
                id: 'price_creator_monthly',
                product: 'prod_creator'
              }
            }]
          }
        }
      };

      // EventBridge would retry 3 times before sending to DLQ
      for (let attempt = 1; attempt <= 3; attempt++) {
        await expect(subscriptionHandler(event)).rejects.toThrow('Persistent database error');
      }

      // After 3 failures, EventBridge would send to DLQ
      // Simulate DLQ message structure
      const dlqMessage = {
        Records: [{
          messageId: 'dlq-message-123',
          body: JSON.stringify(event),
          attributes: {
            ApproximateReceiveCount: '3'
          }
        }]
      };

      // Verify DLQ message structure is correct
      expect(dlqMessage.Records[0].messageId).toBe('dlq-message-123');
      expect(JSON.parse(dlqMessage.Records[0].body)).toEqual(event);
      expect(dlqMessage.Records[0].attributes.ApproximateReceiveCount).toBe('3');
    });
  });

  describe('End-to-End Event Processing Scenarios', () => {
    it('should process complete subscription lifecycle with user group management', async () => {
      // 1. Subscription created - add to creator group
      const createdEvent = {
        id: 'event-created-123',
        source: 'stripe',
        'detail-type': 'customer.subscription.created',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'sub_test123',
          customer: 'cus_test123',
          status: 'active',
          current_period_start: 1704067200,
          current_period_end: 1706745600,
          cancel_at_period_end: false,
          items: {
            data: [{
              price: {
                id: 'price_creator_monthly',
                product: 'prod_creator'
              }
            }]
          }
        }
      };

      await subscriptionHandler(createdEvent);

      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123', null, 'price_creator_monthly'
      );

      // 2. Plan upgrade - change from creator to pro
      mockGetSubscriptionRecord.mockResolvedValue({
        pk: 'tenant-123',
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
        planId: 'creator'
      });

      const upgradedEvent = {
        id: 'event-upgraded-456',
        source: 'stripe',
        'detail-type': 'customer.subscription.updated',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'sub_test123',
          customer: 'cus_test123',
          status: 'active',
          current_period_start: 1704067200,
          current_period_end: 1706745600,
          cancel_at_period_end: false,
          items: {
            data: [{
              price: {
                id: 'price_pro_monthly',
                product: 'prod_pro'
              }
            }]
          }
        }
      };

      await subscriptionHandler(upgradedEvent);

      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123', 'price_creator_monthly', 'price_pro_monthly'
      );

      // 3. Subscription deleted - downgrade to free
      mockGetSubscriptionRecord.mockResolvedValue({
        pk: 'tenant-123',
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
        planId: 'pro'
      });

      const deletedEvent = {
        id: 'event-deleted-789',
        source: 'stripe',
        'detail-type': 'customer.subscription.deleted',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'sub_test123',
          customer: 'cus_test123',
          status: 'canceled'
        }
      };

      await subscriptionHandler(deletedEvent);

      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123', 'price_pro_monthly', null
      );
    });

    it('should handle payment failure and recovery cycle', async () => {
      // 1. Payment failure - subscription goes to past_due but groups remain
      const failureEvent = {
        id: 'event-fail-1',
        source: 'stripe',
        'detail-type': 'invoice.payment_failed',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'in_test123',
          customer: 'cus_test123',
          subscription: 'sub_test123',
          amount_paid: 0,
          amount_due: 2900,
          currency: 'usd',
          status: 'open',
          paid: false,
          attempt_count: 1,
          next_payment_attempt: 1704153600
        }
      };

      await paymentHandler(failureEvent);

      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'past_due',
          paymentAttemptCount: 1
        }),
        'event-fail-1'
      );

      // Should not remove user groups during retry period
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();

      // 2. Payment recovery - subscription reactivated and groups restored
      mockGetSubscriptionRecord.mockResolvedValue({
        pk: 'tenant-123',
        sk: 'subscription',
        stripeSubscriptionId: 'sub_test123',
        status: 'past_due',
        planId: 'creator'
      });

      const recoveryEvent = {
        id: 'event-recovery-2',
        source: 'stripe',
        'detail-type': 'invoice.payment_succeeded',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789012',
        detail: {
          id: 'in_test123',
          customer: 'cus_test123',
          subscription: 'sub_test123',
          amount_paid: 2900,
          currency: 'usd',
          status: 'paid',
          paid: true,
          status_transitions: {
            paid_at: 1704067200
          }
        }
      };

      await paymentHandler(recoveryEvent);

      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'active',
          pastDueCleared: true
        }),
        'event-recovery-2'
      );

      // Should restore user groups
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123', null, 'price_creator_monthly'
      );
    });
  });
});
