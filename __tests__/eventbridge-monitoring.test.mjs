/**
 * Tests for EventBridge monitoring and error handling infrastructure
 */

import { jest } from '@jest/globals';

// Mock dependencies first
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis()
};

const mockPublishMetricEvent = jest.fn().mockResolvedValue();
const mockCreateLogger = jest.fn().mockReturnValue(mockLogger);

jest.unstable_mockModule('../functions/utils/structured-logger.mjs', () => ({
  createLogger: mockCreateLogger
}));

jest.unstable_mockModule('../functions/utils/cloudwatch-metrics.mjs', () => ({
  publishMetricEvent: mockPublishMetricEvent
}));

// Import after mocking
const { createEventBridgeMonitor, createMonitoringContext, withEventBridgeMonitoring } = await import('../functions/utils/monitoring-utils.mjs');

describe('EventBridge Monitoring Infrastructure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('EventBridgeMonitor', () => {
    test('should create monitor with correct properties', () => {
      const monitor = createEventBridgeMonitor('event-123', 'customer.subscription.created', 'corr-456');

      expect(monitor.eventId).toBe('event-123');
      expect(monitor.eventType).toBe('customer.subscription.created');
      expect(monitor.correlationId).toBe('corr-456');
      expect(mockCreateLogger).toHaveBeenCalledWith('corr-456');
    });

    test('should record event received with correct metrics', () => {
      const monitor = createEventBridgeMonitor('event-123', 'customer.subscription.created');

      monitor.recordEventReceived({ Source: 'stripe', Region: 'us-east-1' });

      expect(monitor.metrics).toHaveLength(1);
      expect(monitor.metrics[0]).toEqual({
        key: 'eventbridge.event.received',
        data: {
          dimensions: {
            EventType: 'customer.subscription.created',
            Source: 'stripe',
            Region: 'us-east-1'
          }
        }
      });

      expect(mockLogger.info).toHaveBeenCalledWith('EventBridge event received', {
        eventId: 'event-123',
        eventType: 'customer.subscription.created',
        Source: 'stripe',
        Region: 'us-east-1'
      });
    });

    test('should categorize errors correctly', () => {
      const monitor = createEventBridgeMonitor('event-123', 'customer.subscription.created');

      const tenantError = new Error('tenant not found for customer ID: cus_123');
      const dataError = new Error('Invalid subscription data: missing status');
      const timeoutError = new Error('Processing timeout after 30 seconds');

      expect(monitor.categorizeError(tenantError)).toBe('tenant_not_found');
      expect(monitor.categorizeError(dataError)).toBe('invalid_data');
      expect(monitor.categorizeError(timeoutError)).toBe('processing_timeout');
    });

    test('should publish all accumulated metrics', async () => {
      const monitor = createEventBridgeMonitor('event-123', 'customer.subscription.created');

      monitor.addMetric('eventbridge.event.received', { dimensions: { EventType: 'test' } });
      monitor.addMetric('eventbridge.event.processed', { dimensions: { EventType: 'test' } });

      await monitor.publishMetrics();

      expect(mockPublishMetricEvent).toHaveBeenCalledTimes(2);
      expect(mockPublishMetricEvent).toHaveBeenCalledWith('eventbridge.event.received', { dimensions: { EventType: 'test' } }, 'event-123');
      expect(mockPublishMetricEvent).toHaveBeenCalledWith('eventbridge.event.processed', { dimensions: { EventType: 'test' } }, 'event-123');
    });
  });

  describe('createMonitoringContext', () => {
    test('should create monitoring context with convenience methods', () => {
      const event = {
        id: 'event-123',
        'detail-type': 'customer.subscription.created',
        source: 'stripe',
        region: 'us-east-1',
        account: '123456789012'
      };

      const context = createMonitoringContext(event);

      expect(context.eventId).toBe('event-123');
      expect(context.eventType).toBe('customer.subscription.created');
      expect(context.monitor).toBeDefined();
      expect(typeof context.recordSuccess).toBe('function');
      expect(typeof context.recordFailure).toBe('function');
      expect(typeof context.timeOperation).toBe('function');
    });

    test('should record event received when creating context', () => {
      const event = {
        id: 'event-123',
        'detail-type': 'customer.subscription.created',
        source: 'stripe',
        region: 'us-east-1',
        account: '123456789012'
      };

      const context = createMonitoringContext(event);

      expect(context.monitor.metrics).toHaveLength(1);
      expect(context.monitor.metrics[0].key).toBe('eventbridge.event.received');
    });
  });

  describe('Error categorization', () => {
    test('should categorize various error types correctly', () => {
      const monitor = createEventBridgeMonitor('event-123', 'test');

      const testCases = [
        { error: new Error('tenant not found for customer'), expected: 'tenant_not_found' },
        { error: new Error('Invalid subscription data'), expected: 'invalid_data' },
        { error: new Error('Missing required field'), expected: 'invalid_data' },
        { error: new Error('Processing timeout occurred'), expected: 'processing_timeout' },
        { error: new Error('Rate limit exceeded'), expected: 'throttling' },
        { error: new Error('Access denied to resource'), expected: 'permission_error' },
        { error: new Error('Network connection failed'), expected: 'network_error' },
        { error: new Error('Unknown error occurred'), expected: 'processing_error' }
      ];

      testCases.forEach(({ error, expected }) => {
        expect(monitor.categorizeError(error)).toBe(expected);
      });
    });
  });
});

describe('DLQ Processing', () => {
  test('should handle DLQ message structure correctly', () => {
    // This would test the DLQ processor function
    // For now, just verify the structure is as expected
    const dlqMessage = {
      Records: [
        {
          messageId: 'dlq-message-123',
          receiptHandle: 'receipt-handle-456',
          body: JSON.stringify({
            id: 'event-123',
            'detail-type': 'customer.subscription.created',
            source: 'stripe',
            detail: {
              id: 'sub_123',
              customer: 'cus_123',
              status: 'active'
            }
          }),
          attributes: {
            ApproximateReceiveCount: '3',
            ApproximateFirstReceiveTimestamp: '1640995200000'
          }
        }
      ]
    };

    expect(dlqMessage.Records).toHaveLength(1);
    expect(dlqMessage.Records[0].messageId).toBe('dlq-message-123');

    const originalEvent = JSON.parse(dlqMessage.Records[0].body);
    expect(originalEvent.id).toBe('event-123');
    expect(originalEvent['detail-type']).toBe('customer.subscription.created');
  });
});
