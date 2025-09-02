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
const mockCreateHmac = jest.fn();
jest.unstable_mockModule('crypto', () => ({
  default: {
    createHmac: mockCreateHmac
  }
}));

// Import the handler after mocking
const { handler } = await import('../functions/billing/stripe-webhook-handler.mjs');

describe('Stripe Webhook Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock SSM parameter retrieval
    mockGetParameter.mockResolvedValue('whsec_test_secret');

    // Mock current time for signature validation
    jest.spyOn(Date, 'now').mockReturnValue(1640995200000); // Fixed timestamp
    jest.spyOn(Math, 'floor').mockReturnValue(1640995200); // Fixed timestamp in seconds

    // Default crypto mock setup
    mockCreateHmac.mockReturnValue({
      update: jest.fn().mockReturnValue({
        digest: jest.fn().mockReturnValue('valid_signature')
      })
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createWebhookEvent = (type, data, signature = 't=1640995200,v1=valid_signature') => ({
    headers: {
      'stripe-signature': signature
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
    canceled_at: null,
    items: {
      data: [{
        price: {
          id: 'price_creator_monthly'
        }
      }]
    }
  };

  describe('webhook signature verification', () => {
    test('should verify valid signature', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] });
      mockSend.mockResolvedValueOnce({});

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockCreateHmac).toHaveBeenCalledWith('sha256', 'whsec_test_secret');
    });

    test('should reject invalid signature', async () => {
      mockCreateHmac.mockReturnValue({
        update: jest.fn().mockReturnValue({
          digest: jest.fn().mockReturnValue('invalid_signature')
        })
      });

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({ error: 'Unauthorized' });
    });

    test('should reject missing signature', async () => {
      const event = {
        headers: {},
        body: JSON.stringify({ type: 'customer.subscription.created' })
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({ error: 'Missing Stripe signature' });
    });

    test('should reject timestamp too old', async () => {
      // Mock old timestamp (more than 5 minutes ago)
      jest.spyOn(Math, 'floor').mockReturnValue(1640995200 + 400); // 400 seconds later

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    test('should handle malformed signature', async () => {
      const event = createWebhookEvent(
        'customer.subscription.created',
        mockSubscription,
        'invalid_format'
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });
  });

  describe('subscription.created event', () => {
    test('should create subscription record with all fields', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({});

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UpdateItemCommand'
        })
      );
    });

    test('should handle missing plan ID', async () => {
      const subscriptionWithoutPlan = {
        ...mockSubscription,
        items: { data: [{ price: null }] }
      };

      mockSend.mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] });

      const event = createWebhookEvent('customer.subscription.created', subscriptionWithoutPlan);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
    });

    test('should handle tenant not found', async () => {
      // Clear all previous mocks to ensure clean state
      jest.clearAllMocks();

      // Mock empty result for tenant lookup
      mockSend.mockResolvedValueOnce({ Items: [] }); // No tenant found

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('subscription.updated event', () => {
    test('should handle cancellation with period end access', async () => {
      const cancelledSubscription = {
        ...mockSubscription,
        cancel_at_period_end: true,
        canceled_at: 1640995200
      };

      const currentSubscription = {
        status: 'active',
        planId: 'price_creator_monthly',
        cancelAtPeriodEnd: false
      };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } })
        .mockResolvedValueOnce({});

      const event = createWebhookEvent('customer.subscription.updated', cancelledSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      // Should not update groups immediately for cancelled but active subscription
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });

    test('should handle cancellation reversal', async () => {
      const uncancelledSubscription = {
        ...mockSubscription,
        cancel_at_period_end: false,
        canceled_at: null
      };

      const currentSubscription = {
        status: 'active',
        planId: 'price_creator_monthly',
        cancelAtPeriodEnd: true,
        canceledAt: '2022-01-01T00:00:00.000Z',
        accessEndsAt: '2022-02-01T00:00:00.000Z'
      };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } })
        .mockResolvedValueOnce({});

      const event = createWebhookEvent('customer.subscription.updated', uncancelledSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      // Verify cancellation data is cleared in update
      const updateCall = mockSend.mock.calls.find(call =>
        call[0].type === 'UpdateItemCommand'
      );
      expect(updateCall).toBeDefined();
    });

    test('should handle status change from active to inactive', async () => {
      const inactiveSubscription = {
        ...mockSubscription,
        status: 'canceled'
      };

      const currentSubscription = {
        status: 'active',
        planId: 'price_creator_monthly'
      };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } })
        .mockResolvedValueOnce({});

      mockUpdateTenantUserGroupsByPriceId.mockResolvedValueOnce({});

      const event = createWebhookEvent('customer.subscription.updated', inactiveSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant123',
        'price_creator_monthly',
        null
      );
    });
  });

  describe('subscription.deleted event', () => {
    test('should downgrade users when subscription is deleted', async () => {
      const currentSubscription = {
        status: 'cancelled',
        planId: 'price_creator_monthly'
      };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } })
        .mockResolvedValueOnce({});

      mockUpdateTenantUserGroupsByPriceId.mockResolvedValueOnce({});

      const event = createWebhookEvent('customer.subscription.deleted', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant123',
        'price_creator_monthly',
        null
      );
    });

    test('should handle deletion without current subscription', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: null });

      const event = createWebhookEvent('customer.subscription.deleted', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });
  });

  describe('invoice events', () => {
    const mockInvoice = {
      id: 'in_test123',
      customer: 'cus_test123',
      subscription: 'sub_test123'
    };

    test('should restore access on payment success after past_due', async () => {
      const currentSubscription = {
        status: 'past_due',
        planId: 'price_creator_monthly'
      };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } })
        .mockResolvedValueOnce({});

      mockUpdateTenantUserGroupsByPriceId.mockResolvedValueOnce({});

      const event = createWebhookEvent('invoice.payment_succeeded', mockInvoice);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalledWith(
        'tenant123',
        null,
        'price_creator_monthly'
      );
    });

    test('should skip payment success for active subscriptions', async () => {
      const currentSubscription = {
        status: 'active',
        planId: 'price_creator_monthly'
      };

      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({ Item: { unmarshalled: currentSubscription } });

      const event = createWebhookEvent('invoice.payment_succeeded', mockInvoice);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });

    test('should handle payment failure', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({});

      const event = createWebhookEvent('invoice.payment_failed', mockInvoice);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      // Should update status but not remove groups immediately
      expect(mockUpdateTenantUserGroupsByPriceId).not.toHaveBeenCalled();
    });

    test('should skip invoices without subscription', async () => {
      const invoiceWithoutSub = {
        ...mockInvoice,
        subscription: null
      };

      const event = createWebhookEvent('invoice.payment_succeeded', invoiceWithoutSub);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('should handle database query errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({ error: 'Internal server error' });
    });

    test('should handle malformed JSON', async () => {
      const event = {
        headers: { 'stripe-signature': 't=1640995200,v1=valid_signature' },
        body: 'invalid json'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
    });

    test('should handle unrecognized event types gracefully', async () => {
      const event = createWebhookEvent('customer.unknown_event', {});
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ received: true });
    });

    test('should continue processing even if group update fails', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] })
        .mockResolvedValueOnce({});

      mockUpdateTenantUserGroupsByPriceId.mockRejectedValueOnce(new Error('Group update failed'));

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateTenantUserGroupsByPriceId).toHaveBeenCalled();
    });
  });

  describe('helper functions', () => {
    test('should find tenant by customer ID', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ unmarshalled: mockTenant }] });

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      await handler(event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'QueryCommand'
        })
      );
    });

    test('should handle tenant lookup failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Query failed'));

      const event = createWebhookEvent('customer.subscription.created', mockSubscription);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
    });
  });
});
