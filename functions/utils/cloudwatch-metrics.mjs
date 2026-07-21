/**
 * CloudWatch Custom Metrics Utility
 *
 * Provides an event-driven approach for publishing custom metrics to CloudWatch
 * for monitoring the notification system health and performance.
 */

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatchClient({});

/**
 * Metric event types and their configurations
 */
const METRIC_CONFIGS = {

    // Notification operations
    'notification.published': {
        namespace: 'Newsletter/Notifications',
        metricName: 'NotificationPublishSuccess',
        unit: 'Count',
        value: 1
    },
    'notification.failed': {
        namespace: 'Newsletter/Notifications',
        metricName: 'NotificationPublishFailure',
        unit: 'Count',
        value: 1
    },
    'notification.duration': {
        namespace: 'Newsletter/Notifications',
        metricName: 'NotificationPublishDuration',
        unit: 'Milliseconds'
    },

    // EventBridge operations
    'event.processed': {
        namespace: 'Newsletter/EventBridge',
        metricName: 'EventProcessingSuccess',
        unit: 'Count',
        value: 1
    },
    'event.failed': {
        namespace: 'Newsletter/EventBridge',
        metricName: 'EventProcessingFailure',
        unit: 'Count',
        value: 1
    },
    'event.duration': {
        namespace: 'Newsletter/EventBridge',
        metricName: 'EventProcessingDuration',
        unit: 'Milliseconds'
    },

    // API operations
    'api.request': {
        namespace: 'Newsletter/API',
        metricName: 'APIRequestCount',
        unit: 'Count',
        value: 1
    },
    'api.error': {
        namespace: 'Newsletter/API',
        metricName: 'APIErrorCount',
        unit: 'Count',
        value: 1
    },
    'api.duration': {
        namespace: 'Newsletter/API',
        metricName: 'APIResponseTime',
        unit: 'Milliseconds'
    },

    // Authentication operations
    'auth.success': {
        namespace: 'Newsletter/Auth',
        metricName: 'AuthenticationSuccess',
        unit: 'Count',
        value: 1
    },
    'auth.failed': {
        namespace: 'Newsletter/Auth',
        metricName: 'AuthenticationFailure',
        unit: 'Count',
        value: 1
    },

    // Business metrics
    'user.created': {
        namespace: 'Newsletter/Business',
        metricName: 'UserCreated',
        unit: 'Count',
        value: 1
    },
    'brand.updated': {
        namespace: 'Newsletter/Business',
        metricName: 'BrandUpdated',
        unit: 'Count',
        value: 1
    },
    'apikey.created': {
        namespace: 'Newsletter/Business',
        metricName: 'APIKeyCreated',
        unit: 'Count',
        value: 1
    },

    // Billing/Subscription metrics
    'subscription.created': {
        namespace: 'Newsletter/Billing',
        metricName: 'SubscriptionCreated',
        unit: 'Count',
        value: 1
    },
    'subscription.updated': {
        namespace: 'Newsletter/Billing',
        metricName: 'SubscriptionUpdated',
        unit: 'Count',
        value: 1
    },
    'subscription.deleted': {
        namespace: 'Newsletter/Billing',
        metricName: 'SubscriptionDeleted',
        unit: 'Count',
        value: 1
    },
    'subscription.failed': {
        namespace: 'Newsletter/Billing',
        metricName: 'SubscriptionProcessingFailed',
        unit: 'Count',
        value: 1
    },
    'payment.succeeded': {
        namespace: 'Newsletter/Billing',
        metricName: 'PaymentSucceeded',
        unit: 'Count',
        value: 1
    },
    'payment.failed': {
        namespace: 'Newsletter/Billing',
        metricName: 'PaymentFailed',
        unit: 'Count',
        value: 1
    },

    // EventBridge-specific metrics
    'eventbridge.event.received': {
        namespace: 'Newsletter/EventBridge',
        metricName: 'EventsReceived',
        unit: 'Count',
        value: 1
    },
    'eventbridge.event.processed': {
        namespace: 'Newsletter/EventBridge',
        metricName: 'EventsProcessedSuccessfully',
        unit: 'Count',
        value: 1
    },
    'eventbridge.event.failed': {
        namespace: 'Newsletter/EventBridge',
        metricName: 'EventProcessingFailures',
        unit: 'Count',
        value: 1
    },
    'eventbridge.event.retried': {
        namespace: 'Newsletter/EventBridge',
        metricName: 'EventsRetried',
        unit: 'Count',
        value: 1
    },
    'eventbridge.event.dlq': {
        namespace: 'Newsletter/EventBridge',
        metricName: 'EventsSentToDLQ',
        unit: 'Count',
        value: 1
    },
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
    'eventbridge.subscription.processed': {
        namespace: 'Newsletter/EventBridge/Business',
        metricName: 'SubscriptionEventsProcessed',
        unit: 'Count',
        value: 1
    },
    'eventbridge.payment.processed': {
        namespace: 'Newsletter/EventBridge/Business',
        metricName: 'PaymentEventsProcessed',
        unit: 'Count',
        value: 1
    },
    'eventbridge.error.tenant_not_found': {
        namespace: 'Newsletter/EventBridge/Errors',
        metricName: 'TenantNotFoundErrors',
        unit: 'Count',
        value: 1
    },
    'eventbridge.error.invalid_data': {
        namespace: 'Newsletter/EventBridge/Errors',
        metricName: 'InvalidDataErrors',
        unit: 'Count',
        value: 1
    },
    'eventbridge.error.processing_timeout': {
        namespace: 'Newsletter/EventBridge/Errors',
        metricName: 'ProcessingTimeoutErrors',
        unit: 'Count',
        value: 1
    }
};

/**
 * Publish a metric event to CloudWatch
 * @param {string} eventType - Type of metric event (e.g., 'notification.published')
 * @param {Object} eventData - Event data containing value, dimensions, etc.
 * @param {string} correlationId - Correlation ID for logging
 */
export const publishMetricEvent = async (eventType, eventData = {}, correlationId) => {
    try {
        const config = METRIC_CONFIGS[eventType];
        if (!config) {
            console.warn('Unknown metric event type', { eventType, correlationId });
            return;
        }

        // Extract event data with defaults
        const {
            value = config.value,
            dimensions = {},
            timestamp = new Date(),
            unit = config.unit
        } = eventData;

        // Normalize dimensions to ensure they're strings
        const normalizedDimensions = Object.entries(dimensions)
            .map(([Name, Value]) => ({
                Name,
                Value: String(Value || 'UNKNOWN')
            }));

        const metricData = {
            MetricName: config.metricName,
            Value: value,
            Unit: unit,
            Timestamp: timestamp,
            Dimensions: normalizedDimensions
        };

        const command = new PutMetricDataCommand({
            Namespace: config.namespace,
            MetricData: [metricData]
        });

        await cloudwatch.send(command);

        console.log('Published CloudWatch metric event', {
            correlationId,
            eventType,
            namespace: config.namespace,
            metricName: config.metricName,
            value,
            unit,
            dimensions: normalizedDimensions
        });
    } catch (error) {
        console.error('Failed to publish CloudWatch metric event', {
            correlationId,
            eventType,
            error: error.message,
            stack: error.stack
        });
        // Don't throw - metrics publishing should not break the main flow
    }
};

/**
 * Convenience wrapper for timing operations and publishing duration metrics
 * @param {string} eventType - Base event type (e.g., 'notification')
 * @param {Function} operation - Async operation to time
 * @param {Object} dimensions - Additional dimensions for the metric
 * @param {string} correlationId - Correlation ID for logging
 * @returns {Promise} - Result of the operation
 */
export const timeOperation = async (eventType, operation, dimensions = {}, correlationId) => {
    const startTime = Date.now();
    let success = false;
    let result;

    try {
        result = await operation();
        success = true;
        return result;
    } catch (error) {
        success = false;
        throw error;
    } finally {
        const duration = Date.now() - startTime;

        // Publish duration metric
        await publishMetricEvent(`${eventType}.duration`, {
            value: duration,
            dimensions
        }, correlationId);

        // Publish success/failure metric
        const outcomeEvent = success ? `${eventType}.generated` : `${eventType}.failed`;
        await publishMetricEvent(outcomeEvent, {
            dimensions: success ? dimensions : { ...dimensions, ErrorType: 'OPERATION_FAILED' }
        }, correlationId);
    }
};
