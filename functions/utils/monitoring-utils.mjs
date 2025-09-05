/**
 * Comprehensive Monitoring Utilities for EventBridge System
 *
 * Provides utilities for monitoring EventBridge event processing health,
 * publishing custom met creating monitoring dashboards.
 */

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { createLogger } from './structured-logger.mjs';
import { publishMetricEvent } from './cloudwatch-metrics.mjs';

const cloudwatch = new CloudWatchClient({});

/**
 * EventBridge-specific metric configurations
 */
const EVENTBRIDGE_METRICS = {
  // Processing metrics
  'eventbridge.event.received': {
    namespace: 'Newsletter/EventBridge',
    metricName: 'EventsReceived',
    unit: 'Count'
  },
  'eventbridge.event.processed': {
    namespace: 'Newsletter/EventBridge',
    metricName: 'EventsProcessedSuccessfully',
    unit: 'Count'
  },
  'eventbridge.event.failed': {
    namespace: 'Newsletter/EventBridge',
    metricName: 'EventProcessingFailures',
    unit: 'Count'
  },
  'eventbridge.event.retried': {
    namespace: 'Newsletter/EventBridge',
    metricName: 'EventsRetried',
    unit: 'Count'
  },
  'eventbridge.event.dlq': {
    namespace: 'Newsletter/EventBridge',
    metricName: 'EventsSentToDLQ',
    unit: 'Count'
  },

  // Performance metrics
  'eventbridge.processing.duration': {
    namespace: 'Newsletter/EventBridge',
    metricName: 'ProcessingDuration',
    unit: 'Milliseconds'
  },
  'eventbridge.processing.latency': {
    namespace: 'Newsletter/EventBridge',
    metricName: 'ProcessingLatency',
    unit: 'Milliseconds'
  },

  // Business metrics
  'eventbridge.subscription.processed': {
    namespace: 'Newsletter/EventBridge/Business',
    metricName: 'SubscriptionEventsProcessed',
    unit: 'Count'
  },
  'eventbridge.payment.processed': {
    namespace: 'Newsletter/EventBridge/Business',
    metricName: 'PaymentEventsProcessed',
    unit: 'Count'
  },

  // Error categorization
  'eventbridge.error.tenant_not_found': {
    namespace: 'Newsletter/EventBridge/Errors',
    metricName: 'TenantNotFoundErrors',
    unit: 'Count'
  },
  'eventbridge.error.invalid_data': {
    namespace: 'Newsletter/EventBridge/Errors',
    metricName: 'InvalidDataErrors',
    unit: 'Count'
  },
  'eventbridge.error.processing_timeout': {
    namespace: 'Newsletter/EventBridge/Errors',
    metricName: 'ProcessingTimeoutErrors',
    unit: 'Count'
  }
};

/**
 * Enhanced EventBridge monitoring context
 */
export class EventBridgeMonitor {
  constructor(eventId, eventType, correlationId) {
    this.eventId = eventId;
    this.eventType = eventType;
    this.correlationId = correlationId;
    this.logger = createLogger(correlationId);
    this.startTime = Date.now();
    this.metrics = [];
  }

  /**
   * Record that an event was received
   * @param {Object} dimensions - Additional metric dimensions
   */
  recordEventReceived(dimensions = {}) {
    this.addMetric('eventbridge.event.received', {
      dimensions: {
        EventType: this.eventType,
        ...dimensions
      }
    });

    this.logger.info('EventBridge event received', {
      eventId: this.eventId,
      eventType: this.eventType,
      ...dimensions
    });
  }

  /**
   * Record successful event processing
   * @param {Object} result - Processing result
   * @param {Object} dimensions - Additional metric dimensions
   */
  recordEventProcessed(result = {}, dimensions = {}) {
    const processingDuration = Date.now() - this.startTime;

    this.addMetric('eventbridge.event.processed', {
      dimensions: {
        EventType: this.eventType,
        ...dimensions
      }
    });

    this.addMetric('eventbridge.processing.duration', {
      value: processingDuration,
      dimensions: {
        EventType: this.eventType,
        ...dimensions
      }
    });

    // Record business-specific metrics
    if (this.eventType.includes('subscription')) {
      this.addMetric('eventbridge.subscription.processed', {
        dimensions: {
          Action: this.extractActionFromEventType(),
          ...dimensions
        }
      });
    } else if (this.eventType.includes('payment')) {
      this.addMetric('eventbridge.payment.processed', {
        dimensions: {
          Action: this.extractActionFromEventType(),
          ...dimensions
        }
      });
    }

    this.logger.info('EventBridge event processed successfully', {
      eventId: this.eventId,
      eventType: this.eventType,
      processingDurationMs: processingDuration,
      result,
      ...dimensions
    });
  }

  /**
   * Record event processing failure
   * @param {Error} error - Processing error
   * @param {Object} dimensions - Additional metric dimensions
   */
  recordEventFailed(error, dimensions = {}) {
    const processingDuration = Date.now() - this.startTime;
    const errorType = this.categorizeError(error);

    this.addMetric('eventbridge.event.failed', {
      dimensions: {
        EventType: this.eventType,
        ErrorType: errorType,
        ...dimensions
      }
    });

    this.addMetric('eventbridge.processing.duration', {
      value: processingDuration,
      dimensions: {
        EventType: this.eventType,
        Success: 'false',
        ErrorType: errorType,
        ...dimensions
      }
    });

    // Record specific error type metrics
    const errorMetricKey = `eventbridge.error.${errorType.toLowerCase()}`;
    if (EVENTBRIDGE_METRICS[errorMetricKey]) {
      this.addMetric(errorMetricKey, {
        dimensions: {
          EventType: this.eventType,
          ...dimensions
        }
      });
    }

    this.logger.error('EventBridge event processing failed', error, {
      eventId: this.eventId,
      eventType: this.eventType,
      processingDurationMs: processingDuration,
      errorType,
      ...dimensions
    });
  }

  /**
   * Record event retry
   * @param {number} attemptNumber - Retry attempt number
   * @param {Error} previousError - Previous error that caused retry
   * @param {Object} dimensions - Additional metric dimensions
   */
  recordEventRetry(attemptNumber, previousError, dimensions = {}) {
    this.addMetric('eventbridge.event.retried', {
      dimensions: {
        EventType: this.eventType,
        AttemptNumber: attemptNumber.toString(),
        PreviousErrorType: this.categorizeError(previousError),
        ...dimensions
      }
    });

    this.logger.warn('EventBridge event retry', {
      eventId: this.eventId,
      eventType: this.eventType,
      attemptNumber,
      previousError: previousError.message,
      ...dimensions
    });
  }

  /**
   * Record event sent to DLQ
   * @param {Error} finalError - Final error before DLQ
   * @param {number} totalAttempts - Total number of attempts made
   * @param {Object} dimensions - Additional metric dimensions
   */
  recordEventSentToDLQ(finalError, totalAttempts, dimensions = {}) {
    this.addMetric('eventbridge.event.dlq', {
      dimensions: {
        EventType: this.eventType,
        FinalErrorType: this.categorizeError(finalError),
        TotalAttempts: totalAttempts.toString(),
        ...dimensions
      }
    });

    this.logger.error('EventBridge event sent to DLQ', finalError, {
      eventId: this.eventId,
      eventType: this.eventType,
      totalAttempts,
      finalError: finalError.message,
      requiresManualReview: true,
      ...dimensions
    });
  }

  /**
   * Add a metric to be published later
   * @param {string} metricKey - Metric key from EVENTBRIDGE_METRICS
   * @param {Object} metricData - Metric data
   */
  addMetric(metricKey, metricData = {}) {
    this.metrics.push({
      key: metricKey,
      data: metricData
    });
  }

  /**
   * Publish all accumulated metrics
   */
  async publishMetrics() {
    try {
      for (const metric of this.metrics) {
        await publishMetricEvent(metric.key, metric.data, this.correlationId);
      }

      this.logger.info('Published EventBridge monitoring metrics', {
        eventId: this.eventId,
        eventType: this.eventType,
        metricCount: this.metrics.length
      });
    } catch (error) {
      this.logger.error('Failed to publish EventBridge monitoring metrics', error, {
        eventId: this.eventId,
        eventType: this.eventType,
        metricCount: this.metrics.length
      });
      // Don't throw - metrics publishing should not break main flow
    }
  }

  /**
   * Extract action from event type (e.g., 'created' from 'customer.subscription.created')
   * @returns {string} Action name
   */
  extractActionFromEventType() {
    const parts = this.eventType.split('.');
    return parts[parts.length - 1] || 'unknown';
  }

  /**
   * Categorize error for metrics
   * @param {Error} error - Error to categorize
   * @returns {string} Error category
   */
  categorizeError(error) {
    const message = error.message?.toLowerCase() || '';

    if (message.includes('tenant') && message.includes('not found')) {
      return 'tenant_not_found';
    }

    if (message.includes('invalid') || message.includes('missing') || message.includes('malformed')) {
      return 'invalid_data';
    }

    if (message.includes('timeout') || message.includes('time out')) {
      return 'processing_timeout';
    }

    if (message.includes('throttl') || message.includes('rate limit')) {
      return 'throttling';
    }

    if (message.includes('permission') || message.includes('access denied')) {
      return 'permission_error';
    }

    if (message.includes('network') || message.includes('connection')) {
      return 'network_error';
    }

    return 'processing_error';
  }

  /**
   * Create a timing wrapper for operations
   * @param {string} operationName - Name of the operation
   * @param {Function} operation - Async operation to time
   * @param {Object} dimensions - Additional dimensions
   * @returns {Promise} Operation result
   */
  async timeOperation(operationName, operation, dimensions = {}) {
    const startTime = Date.now();
    let success = false;

    try {
      const result = await operation();
      success = true;
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = Date.now() - startTime;

      this.addMetric('eventbridge.processing.duration', {
        value: duration,
        dimensions: {
          EventType: this.eventType,
          Operation: operationName,
          Success: success.toString(),
          ...dimensions
        }
      });

      this.logger.info(`EventBridge operation completed: ${operationName}`, {
        eventId: this.eventId,
        eventType: this.eventType,
        operationName,
        durationMs: duration,
        success,
        ...dimensions
      });
    }
  }
}

/**
 * Create an EventBridge monitor instance
 * @param {string} eventId - Event ID for correlation
 * @param {string} eventType - Type of EventBridge event
 * @param {string} correlationId - Correlation ID for logging
 * @returns {EventBridgeMonitor} Monitor instance
 */
export function createEventBridgeMonitor(eventId, eventType, correlationId = eventId) {
  return new EventBridgeMonitor(eventId, eventType, correlationId);
}

/**
 * Publish EventBridge health check metrics
 * @param {string} functionName - Name of the Lambda function
 * @param {Object} healthData - Health check data
 * @param {string} correlationId - Correlation ID
 */
export async function publishHealthCheckMetrics(functionName, healthData, correlationId) {
  const logger = createLogger(correlationId);

  try {
    const metrics = [
      {
        MetricName: 'FunctionHealth',
        Value: healthData.healthy ? 1 : 0,
        Unit: 'Count',
        Dimensions: [
          { Name: 'FunctionName', Value: functionName },
          { Name: 'HealthStatus', Value: healthData.healthy ? 'Healthy' : 'Unhealthy' }
        ]
      }
    ];

    // Add specific health metrics
    if (healthData.memoryUsage) {
      metrics.push({
        MetricName: 'MemoryUsage',
        Value: healthData.memoryUsage,
        Unit: 'Percent',
        Dimensions: [{ Name: 'FunctionName', Value: functionName }]
      });
    }

    if (healthData.coldStartDuration) {
      metrics.push({
        MetricName: 'ColdStartDuration',
        Value: healthData.coldStartDuration,
        Unit: 'Milliseconds',
        Dimensions: [{ Name: 'FunctionName', Value: functionName }]
      });
    }

    const command = new PutMetricDataCommand({
      Namespace: 'Newsletter/EventBridge/Health',
      MetricData: metrics
    });

    await cloudwatch.send(command);

    logger.info('Published EventBridge health check metrics', {
      functionName,
      healthData,
      metricCount: metrics.length
    });
  } catch (error) {
    logger.error('Failed to publish health check metrics', error, {
      functionName,
      healthData
    });
  }
}

/**
 * Create a comprehensive monitoring context for EventBridge functions
 * @param {Object} event - EventBridge event
 * @returns {Object} Monitoring context with utilities
 */
export function createMonitoringContext(event) {
  const eventId = event.id || 'unknown';
  const eventType = event['detail-type'] || 'unknown';
  const monitor = createEventBridgeMonitor(eventId, eventType);

  // Record that event was received
  monitor.recordEventReceived({
    Source: event.source,
    Region: event.region,
    Account: event.account
  });

  return {
    monitor,
    eventId,
    eventType,

    // Convenience methods
    recordSuccess: (result, dimensions) => monitor.recordEventProcessed(result, dimensions),
    recordFailure: (error, dimensions) => monitor.recordEventFailed(error, dimensions),
    recordRetry: (attempt, error, dimensions) => monitor.recordEventRetry(attempt, error, dimensions),
    timeOperation: (name, operation, dimensions) => monitor.timeOperation(name, operation, dimensions),
    publishMetrics: () => monitor.publishMetrics(),

    // Create child context for sub-operations
    createChildContext: (operationName) => ({
      ...monitor,
      operationName,
      logger: monitor.logger.child({ operation: operationName })
    })
  };
}

/**
 * Wrapper function to add comprehensive monitoring to EventBridge handlers
 * @param {Function} handler - Original event handler function
 * @returns {Function} Wrapped handler with monitoring
 */
export function withEventBridgeMonitoring(handler) {
  return async (event, context) => {
    const monitoring = createMonitoringContext(event);

    try {
      const result = await monitoring.timeOperation('handler-execution', async () => {
        return await handler(event, context);
      });

      monitoring.recordSuccess(result);
      return result;
    } catch (error) {
      monitoring.recordFailure(error);
      throw error;
    } finally {
      await monitoring.publishMetrics();
    }
  };
}

/**
 * Example usage:
 *
 * // In an EventBridge handler function:
 * export const handler = withEventBridgeMonitoring(async (event) => {
 *   const monitoring = createMonitoringContext(event);
 *
 *   try {
 *     const tenant = await monitoring.timeOperation('tenant-lookup', async () => {
 *       return await findTenantByCustomerId(customerId);
 *     });
 *
 *     const result = await monitoring.timeOperation('subscription-update', async () => {
 *       return await updateSubscription(subscriptionData);
 *     });
 *
 *     monitoring.recordSuccess(result, { TenantId: tenant.tenantId });
 *     return result;
 *   } catch (error) {
 *     monitoring.recordFailure(error, { TenantId: tenant?.tenantId });
 *     throw error;
 *   }
 * });
 *
 * // Or use the wrapper:
 * export const handler = withEventBridgeMonitoring(async (event) => {
 *   // Your handler logic here
 *   // Monitoring is automatically added
 * });
 */
