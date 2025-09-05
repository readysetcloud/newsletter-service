/**
 * @fileoverview Tests for EventBridge Stripe subscription event handler
 */

import { jest } from '@jest/globals';

// Mock dependencies
const mockDynamoClient = {
  send: jest.fn()
};

const mockUpdateTenantUserGroupsByPriceId = jest.fn();
const mockGetSubscriptionRecord = jest.fn();
const mockUpdateSubscriptionStatus = jest.fn();
const mockAtomicSubscriptionUpdate = jest.fn();
const mockPublishMetricEvent = jest.fn();

// Mock QueryCommand constructor
const mockQueryCommand = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => mockDynamoClient),
  QueryCommand: mockQueryCommand,
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

jest.unstable_mockModule('../functions/billing/manage-user-groups.mjs', () => ({
  updateTenantUserGroupsByPriceId: mockUpdateTenantUserGroupsByPriceId
}));

jest.unstable_mockModule('../functions/billing/subscription-data.mjs', () => ({
  getSubscriptionRecord: mockGetSubscriptionRecord,
  updateSubscriptionStatus: mockUpdateSubscriptionStatus,
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

jest.unstable_mockModule('../functions/utils/cloudwatch-metrics.mjs', () => ({
  publishMetricEvent: mockPublishMetricEvent
}));

// Import the handler after mocking
const { handler } = await import('../functions/billing/stripe-subscription-events.mjs');

// Test data
const mockTenant = {
  tenantId: 'tenant-123',
  stripeCustomerId: 'cus_test123'
};

const mockSubscription = {
  id: 'sub_test123',
  customer: 'cus_test123',
  status: 'active',
  current_period_start: 1704067200, // 2024-01-01
  current_period_end: 1706745600,   // 2024-02-01
  cancel_at_period_end: false,
  items: {
    data: [{
      price: {
        id: 'price_creator_monthly'
      }
    }]
  }
};

const mockEventBridgeEvent = {
  id: 'event-123',
  source: 'stripe',
  'detail-type': 'customer.subscription.created',
  detail: mockSubscription
};

describe('Stripe Subscription EventBridge Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';

    // Default mock implementations
    mockDynamoClient.send.mockResolvedValue({
      Items: [mockTenant]
    });
    mockUpdateTenantUserGroupsByPriceId.mockResolvedValue({});
    mockAtomicSubscriptionUpdate.mockResolvedValue({});
    mockGetSubscriptionRecord.mockResolvedValue({
      pk: 'tenant-123',
      sk: 'subscription',
      stripeSubscriptionId: 'sub_test123',
      status: 'active',
      planId: 'creator',
      cancelAtPeriodEnd: false
    });
    mockPublishMetricEvent.mockResolvedValue();
  });

  describe('Subscription Created Events', () => {
    test('should process subscription.created event successfully', async () => {
      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.created'
      };

      await handler(event);

      // Verify tenant lookup
      expect(mockDynamoClient.send).toHaveBeenCalled();

      // Verify subscription record creation
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

      // Verify user group update for active subscription
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant-123',
        null,
        'price_creator_monthly'
      );

      // Verify success metric
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'event.processed',
        expect.objectContaining({
          dimensions: expect.objectContaining({
            EventType: 'subscription.created',
            TenantId: 'tenant-123',
            SubscriptionStatus: 'active',
            PlanId: 'creator'
          })
        }),
        'event-123'
      );
    });

    test('should handle subscription.created with inactive status', async () => {
      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.created',
        detail: {
          ...mockSubscription,
          status: 'incomplete'
        }
      };

      await handler(event);

      // Should not update user groups for inactive subscription
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();

      // Should still create subscription record
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'incomplete'
        }),
        'event-123'
      );
    });

    test('should handle idempotent processing for subscription.created', async () => {
      mockAtomicSubscriptionUpdate.mockRejectedValue(
        new Error('Event event-123 already processed for tenant tenant-123, skipping')
      );

      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.created'
      };

      await handler(event);

      // Should not throw error for idempotent processing
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });

    test('should throw error for missing price ID', async () => {
      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.created',
        detail: {
          ...mockSubscription,
          items: { data: [] }
        }
      };

      await expect(handler(event)).rejects.toThrow('No price ID found in subscription');
    });

    test('should throw error for unknown price ID', async () => {
      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.created',
        detail: {
          ...mockSubscription,
          items: {
            data: [{
              price: { id: 'price_unknown' }
            }]
          }
        }
      };

      await expect(handler(event)).rejects.toThrow('Unknown Stripe price ID: price_unknown');
    });

    test('should throw error for missing tenant', async () => {
      mockDynamoClient.send.mockResolvedValue({ Items: [] });

      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.created'
      };

      await expect(handler(event)).rejects.toThrow('No tenant found for customer ID: cus_test123');
    });
  });

  describe('Subscription Updated Events', () => {
    test('should process subscription.updated event successfully', async () => {
      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.updated',
        detail: {
          ...mockSubscription,
          cancel_at_period_end: true,
          canceled_at: 1704067200
        }
      };

      await handler(event);

      // Verify subscription record update
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          cancelAtPeriodEnd: true,
          canceledAt: '2024-01-01T00:00:00.000Z',
          accessEndsAt: '2024-02-01T00:00:00.000Z',
          lastEventId: 'event-123'
        }),
        'event-123'
      );

      // Verify success metric
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'event.processed',
        expect.objectContaining({
          dimensions: expect.objectContaining({
            EventType: 'subscription.updated',
            StatusChange: 'active->active'
          })
        }),
        'event-123'
      );
    });

    test('should handle idempotent processing for subscription.updated', async () => {
      mockGetSubscriptionRecord.mockResolvedValue({
        pk: 'tenant-123',
        sk: 'subscription',
        lastEventId: 'event-123' // Same event ID
      });

      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.updated'
      };

      await handler(event);

      // Should skip processing
      expect(mockAtomicSubscriptionUpdate).not.toHaveBeenCalled();
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });
  });

  describe('Subscription Deleted Events', () => {
    test('should process subscription.deleted event successfully', async () => {
      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.deleted'
      };

      await handler(event);

      // Verify subscription record update to deleted
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalledWith(
        'tenant-123',
        expect.objectContaining({
          status: 'deleted',
          deletedAt: expect.any(String),
          lastEventId: 'event-123'
        }),
        'event-123'
      );

      // Verify success metric
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'event.processed',
        expect.objectContaining({
          dimensions: expect.objectContaining({
            EventType: 'subscription.deleted',
            TenantId: 'tenant-123',
            PreviousPlanId: 'creator'
          })
        }),
        'event-123'
      );
    });

    test('should handle missing subscription record gracefully', async () => {
      mockGetSubscriptionRecord.mockResolvedValue(null);

      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.deleted'
      };

      await handler(event);

      // Should not attempt updates
      expect(mockAtomicSubscriptionUpdate).not.toHaveBeenCalled();
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });

    test('should not downgrade free plan users', async () => {
      mockGetSubscriptionRecord.mockResolvedValue({
        pk: 'tenant-123',
        sk: 'subscription',
        planId: 'free'
      });

      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.deleted'
      };

      await handler(event);

      // Should not call user group update for free plan
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid event structure', async () => {
      const event = {
        id: 'event-123'
        // Missing required fields
      };

      await expect(handler(event)).rejects.toThrow('Invalid EventBridge event structure');

      // Should publish failure metric
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'event.failed',
        expect.objectContaining({
          dimensions: expect.objectContaining({
            EventType: 'unknown',
            ErrorType: 'Error'
          })
        }),
        'event-123'
      );
    });

    test('should handle unexpected event source', async () => {
      const event = {
        ...mockEventBridgeEvent,
        source: 'not-stripe'
      };

      await expect(handler(event)).rejects.toThrow('Unexpected event source: not-stripe');
    });

    test('should handle unhandled event types gracefully', async () => {
      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.unknown'
      };

      await handler(event);

      // Should not throw error, just log and return
      expect(mockAtomicSubscriptionUpdate).not.toHaveBeenCalled();
    });

    test('should publish duration metrics on success', async () => {
      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.created'
      };

      await handler(event);

      // Should publish duration metric
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'event.duration',
        expect.objectContaining({
          value: expect.any(Number),
          dimensions: expect.objectContaining({
            EventType: 'customer.subscription.created',
            Success: 'true'
          })
        }),
        'event-123'
      );
    });

    test('should continue processing even if user group update fails', async () => {
      mockUpdateTenantUserGroupsByPriceId.mockRejectedValue(new Error('Cognito error'));

      const event = {
        ...mockEventBridgeEvent,
        'detail-type': 'customer.subscription.created'
      };

      // Should not throw error
      await handler(event);

      // Should still create subscription record
      expect(mockAtomicSubscriptionUpdate).toHaveBeenCalled();

      // Should still publish success metric
      expect(mockPublishMetricEvent).toHaveBeenCalledWith(
        'event.processed',
        expect.any(Object),
        'event-123'
      );
    });
  });
});
