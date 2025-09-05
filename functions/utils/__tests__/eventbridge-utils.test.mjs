/**
 * Unit tests for EventBridge utilities
 */

import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
const mockMarshall = jest.fn();
const mockUnmarshall = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  QueryCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: mockMarshall,
  unmarshall: mockUnmarshall
}));

// Mock CloudWatch metrics
const mockPublishMetricEvent = jest.fn();
jest.unstable_mockModule('../cloudwatch-metrics.mjs', () => ({
  publishMetricEvent: mockPublishMetricEvent
}));

// Mock structured logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

jest.unstable_mockModule('../structured-logger.mjs', () => ({
  createLogger: jest.fn(() => mockLogger)
}));

// Import after mocking
const {
  parseEventBridgeEvent,
  extractStripeSubscriptionData,
  extractStripePaymentData,
  findTenantByCustomerId,
  publishBillingMetric,
  publishSubscriptionMetric,
  publishPaymentMetric,
  createBillingErrorContext,
  handleBillingEventError,
  validateBillingEvent,
  createBillingEventContext
} = await import('../eventbridge-utils.mjs');

describe('EventBridge Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockMarshall.mockImplementation((obj) => obj);
    mockUnmarshall.mockImplementation((obj) => obj);
    mockPublishMetricEvent.mockResolvedValue();

    // Set environment variables
    process.env.TABLE_NAME = 'test-table';

    // Clear console logs
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('parseEventBridgeEvent', () => {
    it('should parse valid EventBridge event', () => {
      const event = {
        id: 'event-123',
        'detail-type': 'customer.subscription.created',
        source: 'stripe',
        time: '2024-01-01T00:00:00Z',
        region: 'us-east-1',
        account: '123456789',
        detail: { id: 'sub_123' }
      };

      const result = parseEventBridgeEvent(event);

      expect(result).toEqual({
        id: 'event-123',
        type: 'customer.subscription.created',
        source: 'stripe',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        region: 'us-east-1',
        account: '123456789',
        detail: { id: 'sub_123' }
      });
    });

    it('should throw error for missing required fields', () => {
      const event = {
        id: 'event-123',
        source: 'stripe'
        // Missing detail-type and detail
      };

      expect(() => parseEventBridgeEvent(event)).toThrow('Missing required EventBridge fields: detail-type, detail');
    });

    it('should throw error for invalid source', () => {
      const event = {
        id: 'event-123',
        'detail-type': 'customer.subscription.created',
        source: 'invalid-source',
        detail: { id: 'sub_123' }
      };

      expect(() => parseEventBridgeEvent(event)).toThrow('Unexpected event source: invalid-source. Expected: stripe');
    });
  });

  describe('extractStripeSubscriptionData', () => {
    it('should extract subscription data correctly', () => {
      const eventDetail = {
        id: 'sub_123',
        customer: 'cus_456',
        status: 'active',
        current_period_start: 1704067200, // 2024-01-01 00:00:00 UTC
        current_period_end: 1706745600,   // 2024-02-01 00:00:00 UTC
        cancel_at_period_end: false,
        items: {
          data: [{
            price: {
              id: 'price_123',
              product: 'prod_456'
            }
          }]
        }
      };

      const result = extractStripeSubscriptionData(eventDetail);

      expect(result).toEqual({
        id: 'sub_123',
        customerId: 'cus_456',
        status: 'active',
        currentPeriodStart: '2024-01-01T00:00:00.000Z',
        currentPeriodEnd: '2024-02-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        priceId: 'price_123',
        productId: 'prod_456'
      });
    });

    it('should throw error for missing required fields', () => {
      const eventDetail = {
        id: 'sub_123'
        // Missing customer and status
      };

      expect(() => extractStripeSubscriptionData(eventDetail)).toThrow('Missing required Stripe subscription fields: customer, status');
    });

    it('should handle null/undefined event detail', () => {
      expect(() => extractStripeSubscriptionData(null)).toThrow('Invalid event detail: must be an object');
      expect(() => extractStripeSubscriptionData(undefined)).toThrow('Invalid event detail: must be an object');
    });
  });

  describe('extractStripePaymentData', () => {
    it('should extract payment data correctly', () => {
      const eventDetail = {
        id: 'in_123',
        customer: 'cus_456',
        subscription: 'sub_789',
        status: 'paid',
        paid: true,
        amount_paid: 2000,
        amount_due: 2000,
        currency: 'usd',
        period_start: 1704067200,
        period_end: 1706745600,
        due_date: 1704067200,
        attempt_count: 1,
        charge: 'ch_123'
      };

      const result = extractStripePaymentData(eventDetail);

      expect(result).toEqual({
        invoiceId: 'in_123',
        customerId: 'cus_456',
        subscriptionId: 'sub_789',
        status: 'paid',
        paid: true,
        amountPaid: 2000,
        amountDue: 2000,
        currency: 'usd',
        periodStart: '2024-01-01T00:00:00.000Z',
        periodEnd: '2024-02-01T00:00:00.000Z',
        dueDate: '2024-01-01T00:00:00.000Z',
        attemptCount: 1,
        nextPaymentAttempt: null,
        chargeId: 'ch_123'
      });
    });

    it('should throw error for missing required fields', () => {
      const eventDetail = {
        id: 'in_123'
        // Missing customer
      };

      expect(() => extractStripePaymentData(eventDetail)).toThrow('Missing required Stripe invoice fields: customer');
    });
  });

  describe('findTenantByCustomerId', () => {
    it('should find tenant successfully', async () => {
      const mockTenant = { tenantId: 'tenant-123', stripeCustomerId: 'cus_456' };

      mockSend.mockResolvedValue({
        Items: [mockTenant]
      });
      mockUnmarshall.mockReturnValue(mockTenant);

      const result = await findTenantByCustomerId('cus_456', 'correlation-123');

      expect(result).toEqual(mockTenant);
      expect(mockSend).toHaveBeenCalled();
    });

    it('should return null when tenant not found', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await findTenantByCustomerId('cus_nonexistent', 'correlation-123');

      expect(result).toBeNull();
    });

    it('should throw error for missing customer ID', async () => {
      await expect(findTenantByCustomerId('', 'correlation-123')).rejects.toThrow('Customer ID is required');
      await expect(findTenantByCustomerId(null, 'correlation-123')).rejects.toThrow('Customer ID is required');
    });

    it('should handle DynamoDB errors', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(findTenantByCustomerId('cus_456', 'correlation-123')).rejects.toThrow('Failed to lookup tenant by customer ID: DynamoDB error');
    });
  });

  describe('publishBillingMetric', () => {
    it('should publish success metric', async () => {
      await publishBillingMetric('subscription.created', 'success', { TenantId: 'tenant-123' }, 'correlation-123');

      expect(mockPublishMetricEvent).toHaveBeenCalledWith('event.processed', {
        dimensions: {
          EventType: 'subscription.created',
          BillingComponent: 'EventBridge',
          TenantId: 'tenant-123'
        }
      }, 'correlation-123');
    });

    it('should publish failure metric', async () => {
      await publishBillingMetric('subscription.created', 'failure', { ErrorType: 'ValidationError' }, 'correlation-123');

      expect(mockPublishMetricEvent).toHaveBeenCalledWith('event.failed', {
        dimensions: {
          EventType: 'subscription.created',
          BillingComponent: 'EventBridge',
          ErrorType: 'ValidationError'
        }
      }, 'correlation-123');
    });

    it('should handle metric publishing errors gracefully', async () => {
      mockPublishMetricEvent.mockRejectedValue(new Error('CloudWatch error'));

      // Should not throw error
      await expect(publishBillingMetric('subscription.created', 'success', {}, 'correlation-123')).resolves.toBeUndefined();
    });
  });

  describe('publishSubscriptionMetric', () => {
    it('should publish subscription metric with plan ID', async () => {
      const subscriptionData = { status: 'active', planId: 'pro' };

      await publishSubscriptionMetric('created', subscriptionData, 'tenant-123', 'correlation-123');

      expect(mockPublishMetricEvent).toHaveBeenCalledWith('event.processed', {
        dimensions: {
          EventType: 'subscription.created',
          BillingComponent: 'EventBridge',
          TenantId: 'tenant-123',
          SubscriptionStatus: 'active',
          Action: 'created',
          PlanId: 'pro'
        }
      }, 'correlation-123');
    });
  });

  describe('publishPaymentMetric', () => {
    it('should publish payment metric with amount range', async () => {
      const paymentData = { status: 'paid', currency: 'usd', amountPaid: 2000 };

      await publishPaymentMetric('succeeded', paymentData, 'tenant-123', 'correlation-123');

      expect(mockPublishMetricEvent).toHaveBeenCalledWith('event.processed', {
        dimensions: {
          EventType: 'payment.succeeded',
          BillingComponent: 'EventBridge',
          TenantId: 'tenant-123',
          PaymentStatus: 'paid',
          Action: 'succeeded',
          Currency: 'usd',
          AmountRange: '10-50'
        }
      }, 'correlation-123');
    });
  });

  describe('createBillingErrorContext', () => {
    it('should create error context with all fields', () => {
      const error = new Error('Test error');
      error.name = 'ValidationError';

      const eventData = {
        id: 'event-123',
        type: 'subscription.created',
        detail: { id: 'sub_123', customer: 'cus_456' }
      };

      const result = createBillingErrorContext(error, eventData, 'update-subscription');

      expect(result).toEqual({
        operation: 'update-subscription',
        eventId: 'event-123',
        eventType: 'subscription.created',
        stripeObjectId: 'sub_123',
        stripeCustomerId: 'cus_456',
        errorName: 'ValidationError',
        errorMessage: 'Test error',
        timestamp: expect.any(String)
      });
    });
  });

  describe('handleBillingEventError', () => {
    it('should log error and publish metric then re-throw', async () => {
      const error = new Error('Test error');
      const eventData = {
        id: 'event-123',
        type: 'subscription.created',
        detail: { id: 'sub_123' }
      };

      await expect(handleBillingEventError(error, eventData, 'update-subscription', 'correlation-123')).rejects.toThrow('Test error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Billing event processing failed: update-subscription',
        error,
        expect.objectContaining({
          operation: 'update-subscription',
          eventId: 'event-123',
          eventType: 'subscription.created'
        })
      );

      expect(mockPublishMetricEvent).toHaveBeenCalledWith('event.failed', {
        dimensions: {
          EventType: 'subscription.created',
          BillingComponent: 'EventBridge',
          ErrorType: 'Error',
          Operation: 'update-subscription',
          ErrorMessage: 'Test error'
        }
      }, 'correlation-123');
    });
  });

  describe('validateBillingEvent', () => {
    it('should validate subscription event', () => {
      const event = {
        id: 'event-123',
        'detail-type': 'customer.subscription.created',
        source: 'stripe',
        detail: {
          id: 'sub_123',
          customer: 'cus_456',
          status: 'active'
        }
      };

      const result = validateBillingEvent(event);

      expect(result.type).toBe('customer.subscription.created');
      expect(result.subscriptionData).toBeDefined();
      expect(result.subscriptionData.id).toBe('sub_123');
    });

    it('should validate payment event', () => {
      const event = {
        id: 'event-123',
        'detail-type': 'invoice.payment_succeeded',
        source: 'stripe',
        detail: {
          id: 'in_123',
          customer: 'cus_456'
        }
      };

      const result = validateBillingEvent(event);

      expect(result.type).toBe('invoice.payment_succeeded');
      expect(result.paymentData).toBeDefined();
      expect(result.paymentData.invoiceId).toBe('in_123');
    });

    it('should throw error for unsupported event type', () => {
      const event = {
        id: 'event-123',
        'detail-type': 'unsupported.event.type',
        source: 'stripe',
        detail: {}
      };

      expect(() => validateBillingEvent(event)).toThrow('Unsupported billing event type: unsupported.event.type');
    });
  });

  describe('createBillingEventContext', () => {
    it('should create context with utilities for subscription event', () => {
      const event = {
        id: 'event-123',
        'detail-type': 'customer.subscription.created',
        source: 'stripe',
        detail: {
          id: 'sub_123',
          customer: 'cus_456',
          status: 'active'
        }
      };

      const context = createBillingEventContext(event);

      expect(context.eventData).toBeDefined();
      expect(context.logger).toBeDefined();
      expect(typeof context.findTenant).toBe('function');
      expect(typeof context.publishMetric).toBe('function');
      expect(typeof context.handleError).toBe('function');
      expect(typeof context.timeOperation).toBe('function');
    });

    it('should time operation and publish metrics', async () => {
      const event = {
        id: 'event-123',
        'detail-type': 'customer.subscription.created',
        source: 'stripe',
        detail: {
          id: 'sub_123',
          customer: 'cus_456',
          status: 'active'
        }
      };

      const context = createBillingEventContext(event);
      const mockOperation = jest.fn().mockResolvedValue('result');

      const result = await context.timeOperation('test-operation', mockOperation);

      expect(result).toBe('result');
      expect(mockOperation).toHaveBeenCalled();
      expect(mockPublishMetricEvent).toHaveBeenCalledWith('event.duration', {
        value: expect.any(Number),
        dimensions: {
          EventType: 'customer.subscription.created',
          Operation: 'test-operation',
          Success: 'true'
        }
      }, 'event-123');
    });
  });
});
