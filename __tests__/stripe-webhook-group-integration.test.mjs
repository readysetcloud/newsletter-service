import { jest } from '@jest/globals';

// Set up environment variables before importing
process.env.STRIPE_WEBHOOK_SECRET_PARAM = '/stripe/webhook-secret';
process.env.TABLE_NAME = 'test-table';

// Mock SSM parameter retrieval
const mockGetParameter = jest.fn();
jest.unstable_mockModule('@aws-lambda-powertools/parameters/ssm', () => ({
  getParameter: mockGetParameter
}));

// Mock the group management utilities
const mockUpdateTenantUserGroupsByPriceId = jest.fn();

jest.unstable_mockModule('../functions/billing/manage-user-groups.mjs', () => ({
  updateTenantUserGroupsByPriceId: mockUpdateTenantUserGroupsByPriceId
}));

// Mock AWS SDK clients
const mockSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: mockSend
  })),
  UpdateItemCommand: jest.fn((params) => ({ type: 'UpdateItemCommand', ...params })),
  GetItemCommand: jest.fn((params) => ({ type: 'GetItemCommand', ...params })),
  QueryCommand: jest.fn((params) => ({ type: 'QueryCommand', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => ({ marshalled: obj })),
  unmarshall: jest.fn((obj) => obj.unmarshalled || obj)
}));

// Mock crypto for webhook signature verification
jest.unstable_mockModule('crypto', () => ({
  default: {
    createHmac: jest.fn(() => ({
      update: jest.fn(() => ({
        digest: jest.fn(() => 'valid_signature')
      }))
    }))
  }
}));

// Import the handler after mocking
const { handler } = await import('../functions/billing/stripe-webhook-handler.mjs');

describe('Stripe Webhook Group Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock SSM parameter retrieval
    mockGetParameter.mockResolvedValue('whsec_test_secret');

    // Mock current time for signature validation
    jest.spyOn(Date, 'now').mockReturnValue(1640995200000); // Fixed timestamp
    jest.spyOn(Math, 'floor').mockReturnValue(1640995200); // Fixed timestamp in seconds
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createWebhookEvent = (type, data) => ({
    headers: {
      'stripe-signature': 't=1640995200,v1=valid_signature'
    },
    body: JSON.stringify({
      id: 'evt_test',
      type,
      data: { object: data }
    })
  });

  const mockTenant = {
    tenantId: 'tenant123',
    stripeCustomerId: 'cus_test123'
  };

  const mockSubscription = {
    id: 'sub_test123',
    customer: 'cus_test123',
    status: 'active',
    current_period_start: 1640995200,
    current_period_end: 1643673600,
    cancel_at_period_end: false,
    items: {
      data: [{
        price: {
          id: 'price_creator_monthly'
        }
      }]
    }
  };

  describe('subscription.created event', () => {
    test('should update user groups when subscription is created', async () => {
      // Mock finding tenant by customer ID
      mockSend
        .mockResolvedValueOnce({ // findTenantByCustomerId
          Items: [{ unmarshalled: mockTenant }]
        })
        .mockResolvedValueOnce({}); // updateSubscriptionRecord

      mockUpdateTenantUserGroupsByPriceId.mockResolvedValueOnce({
        tenantId: 'tenant123',
        users: 2,
        operations: [{ action: 'add', group: 'creator-tier' }]
      });

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant123',
        null,
        'price_creator_monthly'
      );
    });

    test('should handle group update failure gracefully', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({});

      mockUpdateTenantUserGroupsByPriceId.mockRejectedValueOnce(new Error('Group update failed'));

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200); // Should still succeed
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalled();
    });

    test('should not update groups for inactive subscription', async () => {
      const inactiveSubscription = { ...mockSubscription, status: 'incomplete' };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({});

      const event = createWebhookEvent('customer.subscription.created', inactiveSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });
  });

  describe('subscription.updated event', () => {
    test('should update groups when subscription becomes active', async () => {
      const currentSubscription = { status: 'past_due', planId: 'price_creator_monthly' };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] }) // findTenantByCustomerId
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } }) // getSubscriptionRecord
        .mockResolvedValueOnce({}); // updateSubscriptionRecord

      mockUpdateTenantUserGroupsByPriceId.mockResolvedValueOnce({
        tenantId: 'tenant123',
        users: 2,
        operations: [{ action: 'add', group: 'creator-tier' }]
      });

      const event = createWebhookEvent('customer.subscription.updated', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant123',
        null,
        'price_creator_monthly'
      );
    });

    test('should downgrade groups when subscription becomes inactive', async () => {
      const currentSubscription = { status: 'active', planId: 'price_creator_monthly' };
      const inactiveSubscription = { ...mockSubscription, status: 'canceled' };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } })
        .mockResolvedValueOnce({});

      mockUpdateTenantUserGroupsByPriceId.mockResolvedValueOnce({
        tenantId: 'tenant123',
        users: 2,
        operations: [
          { action: 'remove', group: 'creator-tier' },
          { action: 'add', group: 'free-tier' }
        ]
      });

      const event = createWebhookEvent('customer.subscription.updated', inactiveSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant123',
        'price_creator_monthly',
        null
      );
    });

    test('should handle plan changes', async () => {
      const currentSubscription = { status: 'active', planId: 'price_creator_monthly' };
      const upgradedSubscription = {
        ...mockSubscription,
        items: {
          data: [{
            price: { id: 'price_pro_monthly' }
          }]
        }
      };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } })
        .mockResolvedValueOnce({});

      mockUpdateTenantUserGroupsByPriceId.mockResolvedValueOnce({
        tenantId: 'tenant123',
        users: 2,
        operations: [
          { action: 'remove', group: 'creator-tier' },
          { action: 'add', group: 'pro-tier' }
        ]
      });

      const event = createWebhookEvent('customer.subscription.updated', upgradedSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant123',
        'price_creator_monthly',
        'price_pro_monthly'
      );
    });
  });

  describe('subscription.deleted event', () => {
    test('should downgrade users to free tier', async () => {
      const currentSubscription = { status: 'active', planId: 'price_creator_monthly' };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } })
        .mockResolvedValueOnce({});

      mockUpdateTenantUserGroupsByPriceId.mockResolvedValueOnce({
        tenantId: 'tenant123',
        users: 2,
        operations: [
          { action: 'remove', group: 'creator-tier' },
          { action: 'add', group: 'free-tier' }
        ]
      });

      const event = createWebhookEvent('customer.subscription.deleted', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant123',
        'price_creator_monthly',
        null
      );
    });

    test('should handle missing current subscription', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: null }) // No current subscription
        .mockResolvedValueOnce({});

      const event = createWebhookEvent('customer.subscription.deleted', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });
  });

  describe('invoice.payment_succeeded event', () => {
    test('should restore groups when payment succeeds after past_due', async () => {
      const invoice = {
        id: 'in_test123',
        customer: 'cus_test123',
        subscription: 'sub_test123'
      };

      const currentSubscription = { status: 'past_due', planId: 'price_creator_monthly' };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } })
        .mockResolvedValueOnce({});

      mockUpdateTenantUserGroupsByPriceId.mockResolvedValueOnce({
        tenantId: 'tenant123',
        users: 2,
        operations: [{ action: 'add', group: 'creator-tier' }]
      });

      const event = createWebhookEvent('invoice.payment_succeeded', invoice);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant123',
        null,
        'price_creator_monthly'
      );
    });

    test('should not update groups if subscription was already active', async () => {
      const invoice = {
        id: 'in_test123',
        customer: 'cus_test123',
        subscription: 'sub_test123'
      };

      const currentSubscription = { status: 'active', planId: 'price_creator_monthly' };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } });

      const event = createWebhookEvent('invoice.payment_succeeded', invoice);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });

    test('should skip invoices not associated with subscriptions', async () => {
      const invoice = {
        id: 'in_test123',
        customer: 'cus_test123',
        subscription: null
      };

      const event = createWebhookEvent('invoice.payment_succeeded', invoice);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });
  });

  describe('invoice.payment_failed event', () => {
    test('should update subscription status but not remove groups immediately', async () => {
      const invoice = {
        id: 'in_test123',
        customer: 'cus_test123',
        subscription: 'sub_test123'
      };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({});

      const event = createWebhookEvent('invoice.payment_failed', invoice);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled(); // Groups not updated on payment failure
    });
  });

  describe('error handling', () => {
    test('should return 401 for invalid signature', async () => {
      const event = {
        headers: {
          'stripe-signature': 't=1640995200,v1=invalid_signature'
        },
        body: JSON.stringify({ type: 'customer.subscription.created' })
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    test('should return 400 for missing signature', async () => {
      const event = {
        headers: {},
        body: JSON.stringify({ type: 'customer.subscription.created' })
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });

    test('should return 500 for database errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Database error'));

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
    });

    test('should handle unrecognized event types', async () => {
      const event = createWebhookEvent('customer.unknown_event', {});
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });
  });
});
