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
    // Momento token operations
    'momento.token.generated': {
        namespace: 'Newsletter/Momento',
        metricName: 'TokenGenerationSuccess',
        unit: 'Count',
        value: 1
    },
    'momento.token.failed': {
        namespace: 'Newsletter/Momento',
        metricName: 'TokenGenerationFailure',
        unit: 'Count',
        value: 1
    },
    'momento.token.duration': {
        namespace: 'Newsletter/Momento',
        metricName: 'TokenGenerationDuration',
        unit: 'Milliseconds'
    },

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
    }
};

/**
 * Publish a metric event to CloudWatch
 * @param {string} eventType - Type of metric event (e.g., 'momento.token.generated')
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
 * Publish multiple metric events in a batch
 * @param {Array} events - Array of event objects with { eventType, eventData }
 * @param {string} correlationId - Correlation ID for logging
 */
export const publishMetricEvents = async (events, correlationId) => {
    try {
        // Group events by namespace for efficient batching
        const eventsByNamespace = {};

        for (const { eventType, eventData = {} } of events) {
            const config = METRIC_CONFIGS[eventType];
            if (!config) {
                console.warn('Unknown metric event type in batch', { eventType, correlationId });
                continue;
            }

            if (!eventsByNamespace[config.namespace]) {
                eventsByNamespace[config.namespace] = [];
            }

            const {
                value = config.value,
                dimensions = {},
                timestamp = new Date(),
                unit = config.unit
            } = eventData;

            const normalizedDimensions = Object.entries(dimensions)
                .map(([Name, Value]) => ({
                    Name,
                    Value: String(Value || 'UNKNOWN')
                }));

            eventsByNamespace[config.namespace].push({
                MetricName: config.metricName,
                Value: value,
                Unit: unit,
                Timestamp: timestamp,
                Dimensions: normalizedDimensions
            });
        }

        // Send batched metrics for each namespace
        const promises = Object.entries(eventsByNamespace).map(async ([namespace, metricData]) => {
            const command = new PutMetricDataCommand({
                Namespace: namespace,
                MetricData: metricData
            });

            await cloudwatch.send(command);
        });

        await Promise.all(promises);

        console.log('Published CloudWatch metric events batch', {
            correlationId,
            eventCount: events.length,
            namespaces: Object.keys(eventsByNamespace)
        });
    } catch (error) {
        console.error('Failed to publish CloudWatch metric events batch', {
            correlationId,
            eventCount: events.length,
            error: error.message
        });
    }
};

/**
 * Convenience wrapper for timing operations and publishing duration metrics
 * @param {string} eventType - Base event type (e.g., 'momento.token')
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

/**
 * Create a metrics context for tracking related operations
 * @param {string} correlationId - Correlation ID for logging
 * @returns {Object} - Metrics context with helper methods
 */
export const createMetricsContext = (correlationId) => {
    const events = [];

    return {
        // Add an event to be published later
        addEvent: (eventType, eventData = {}) => {
            events.push({ eventType, eventData });
        },

        // Publish all accumulated events
        publishAll: async () => {
            if (events.length > 0) {
                await publishMetricEvents(events, correlationId);
                events.length = 0; // Clear events after publishing
            }
        },

        // Get current event count
        getEventCount: () => events.length,

        // Time an operation and add metrics
        timeOperation: async (eventType, operation, dimensions = {}) => {
            return timeOperation(eventType, operation, dimensions, correlationId);
        }
    };
};

// Backward compatibility functions (deprecated - use publishMetricEvent instead)
/**
 * @deprecated Use publishMetricEvent('momento.token.generated', { dimensions: { TenantId: tenantId } }, correlationId)
 */
export const publishTokenGenerationSuccess = async (tenantId, correlationId) => {
    await publishMetricEvent('momento.token.generated', {
        dimensions: { TenantId: tenantId }
    }, correlationId);
};

/**
 * @deprecated Use publishMetricEvent('momento.token.failed', { dimensions: { TenantId: tenantId, ErrorType: errorType } }, correlationId)
 */
export const publishTokenGenerationFailure = async (tenantId, errorType, correlationId) => {
    await publishMetricEvent('momento.token.failed', {
        dimensions: { TenantId: tenantId, ErrorType: errorType }
    }, correlationId);
};

/**
 * @deprecated Use publishMetricEvent('momento.token.duration', { value: durationMs, dimensions: { TenantId: tenantId } }, correlationId)
 */
export const publishTokenGenerationDuration = async (tenantId, durationMs, correlationId) => {
    await publishMetricEvent('momento.token.duration', {
        value: durationMs,
        dimensions: { TenantId: tenantId }
    }, correlationId);
};

/**
 * @deprecated Use publishMetricEvent('notification.published', { dimensions: { TenantId: tenantId, EventType: eventType } }, correlationId)
 */
export const publishNotificationSuccess = async (tenantId, eventType, correlationId) => {
    await publishMetricEvent('notification.published', {
        dimensions: { TenantId: tenantId, EventType: eventType }
    }, correlationId);
};

/**
 * @deprecated Use publishMetricEvent('notification.failed', { dimensions: { TenantId: tenantId, EventType: eventType, ErrorType: errorType } }, correlationId)
 */
export const publishNotificationFailure = async (tenantId, eventType, errorType, correlationId) => {
    await publishMetricEvent('notification.failed', {
        dimensions: { TenantId: tenantId, EventType: eventType, ErrorType: errorType }
    }, correlationId);
};

/**
 * @deprecated Use publishMetricEvent('event.processed' or 'event.failed', { dimensions: { EventType: eventType } }, correlationId)
 */
export const publishEventProcessingMetric = async (eventType, success, correlationId) => {
    const metricEventType = success ? 'event.processed' : 'event.failed';
    await publishMetricEvent(metricEventType, {
        dimensions: { EventType: eventType }
    }, correlationId);
};

/**
 * Helper function to get available metric event types
 * @returns {Array} - Array of available event types
 */
export const getAvailableEventTypes = () => {
    return Object.keys(METRIC_CONFIGS);
};

/**
 * Helper function to validate if an event type exists
 * @param {string} eventType - Event type to validate
 * @returns {boolean} - Whether the event type is valid
 */
export const isValidEventType = (eventType) => {
    return eventType in METRIC_CONFIGS;
};

/**
 * Helper function to get metric configuration for an event type
 * @param {string} eventType - Event type
 * @returns {Object|null} - Metric configuration or null if not found
 */
export const getMetricConfig = (eventType) => {
    return METRIC_CONFIGS[eventType] || null;
};

/**
 * Example usage:
 *
 * // Simple event publishing
 * await publishMetricEvent('momento.token.generated', {
 *     dimensions: { TenantId: 'tenant-123' }
 * }, correlationId);
 *
 * // Timing an operation
 * const result = await timeOperation('momento.token', async () => {
 *     return await generateMomentoToken();
 * }, { TenantId: 'tenant-123' }, correlationId);
 *
 * // Using metrics context for batch operations
 * const metrics = createMetricsContext(correlationId);
 * metrics.addEvent('user.created', { dimensions: { TenantId: 'tenant-123' } });
 * metrics.addEvent('brand.updated', { dimensions: { TenantId: 'tenant-123' } });
 * await metrics.publishAll();
 *
 * // Batch publishing multiple events
 * await publishMetricEvents([
 *     { eventType: 'api.request', eventData: { dimensions: { Endpoint: '/profile' } } },
 *     { eventType: 'api.duration', eventData: { value: 150, dimensions: { Endpoint: '/profile' } } }
 * ], correlationId);
 */
