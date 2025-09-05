/**
 * Dead Letter Queue Processor for EventBridge Events
 *
 * Simple processor for handling failed EventBridge events that end up in the DLQ.
 * Focuses on logging, alerting, and preparing for manual review rather than
 * attempting complex recovery operations.
 */

import { createLogger } from '../utils/structured-logger.mjs';
import { publishMetricEvent } from '../utils/cloudwatch-metrics.mjs';

/**
 * Process messages from the EventBridge DLQ
 * @param {Object} event - SQS event containing DLQ messages
 */
export const handler = async (event) => {
  const correlationId = event.Records?.[0]?.messageId || 'dlq-processor';
  const logger = createLogger(correlationId);

  logger.functionStart('dlq-processor', {
    recordCount: event.Records?.length || 0
  });

  const processedMessages = [];
  const failedMessages = [];

  try {
    // Process each DLQ message
    for (const record of event.Records || []) {
      try {
        await processDLQMessage(record, logger);
        processedMessages.push(record.messageId);
      } catch (error) {
        logger.error('Failed to process DLQ message', error, {
          messageId: record.messageId,
          receiptHandle: record.receiptHandle
        });
        failedMessages.push({
          messageId: record.messageId,
          error: error.message
        });
      }
    }

    // Publish metrics
    await publishMetricEvent('event.processed', {
      dimensions: {
        EventType: 'DLQProcessing',
        Proceount: processedMessages.length.toString(),
        FailedCount: failedMessages.length.toString()
      }
    }, correlationId);

    logger.functionEnd('dlq-processor', {
      processedCount: processedMessages.length,
      failedCount: failedMessages.length,
      processedMessages,
      failedMessages
    });

    // Return processing summary
    return {
      statusCode: 200,
      processedCount: processedMessages.length,
      failedCount: failedMessages.length,
      processedMessages,
      failedMessages
    };

  } catch (error) {
    logger.error('DLQ processor function failed', error);

    await publishMetricEvent('event.failed', {
      dimensions: {
        EventType: 'DLQProcessing',
        ErrorType: error.name || 'UnknownError'
      }
    }, correlationId);

    throw error;
  }
};

/**
 * Process a single DLQ message
 * @param {Object} record - SQS record from DLQ
 * @param {Object} logger - Structured logger instance
 */
async function processDLQMessage(record, logger) {
  const messageId = record.messageId;
  const receiptHandle = record.receiptHandle;

  logger.info('Processing DLQ message', {
    messageId,
    messageAttributes: record.messageAttributes,
    approximateReceiveCount: record.attributes?.ApproximateReceiveCount
  });

  try {
    // Parse the original EventBridge event from the DLQ message
    const originalEvent = JSON.parse(record.body);

    // Extract key information for analysis
    const eventAnalysis = analyzeFailedEvent(originalEvent);

    logger.error('EventBridge event failed processing and reached DLQ', null, {
      messageId,
      originalEventId: eventAnalysis.eventId,
      eventType: eventAnalysis.eventType,
      eventSource: eventAnalysis.eventSource,
      stripeObjectId: eventAnalysis.stripeObjectId,
      stripeCustomerId: eventAnalysis.stripeCustomerId,
      failureReason: eventAnalysis.failureReason,
      receiveCount: record.attributes?.ApproximateReceiveCount,
      firstReceiveTime: record.attributes?.ApproximateFirstReceiveTimestamp,
      eventAnalysis
    });

    // Publish specific metrics based on event type
    await publishDLQMetrics(eventAnalysis, messageId);

    // Check if this requires immediate attention
    if (shouldTriggerImmediateAlert(eventAnalysis, record.attributes)) {
      await triggerCriticalAlert(eventAnalysis, record.attributes, logger);
    }

    logger.info('Successfully processed DLQ message', {
      messageId,
      eventType: eventAnalysis.eventType,
      requiresAttention: shouldTriggerImmediateAlert(eventAnalysis, record.attributes)
    });

  } catch (parseError) {
    logger.error('Failed to parse DLQ message body', parseError, {
      messageId,
      bodyPreview: record.body?.substring(0, 200) + '...'
    });

    // Publish metric for unparseable messages
    await publishMetricEvent('event.failed', {
      dimensions: {
        EventType: 'DLQProcessing',
        ErrorType: 'UnparseableMessage'
      }
    }, messageId);

    throw new Error(`Failed to parse DLQ message: ${parseError.message}`);
  }
}

/**
 * Analyze a failed EventBridge event to extract key information
 * @param {Object} originalEvent - Original EventBridge event that failed
 * @returns {Object} Analysis of the failed event
 */
function analyzeFailedEvent(originalEvent) {
  const analysis = {
    eventId: originalEvent.id || 'unknown',
    eventType: originalEvent['detail-type'] || 'unknown',
    eventSource: originalEvent.source || 'unknown',
    timestamp: originalEvent.time || new Date().toISOString(),
    region: originalEvent.region || 'unknown',
    account: originalEvent.account || 'unknown'
  };

  // Extract Stripe-specific information
  if (originalEvent.detail) {
    analysis.stripeObjectId = originalEvent.detail.id;
    analysis.stripeCustomerId = originalEvent.detail.customer;
    analysis.stripeObjectType = originalEvent.detail.object;
  }

  // Determine likely failure reason based on event structure
  analysis.failureReason = determineFailureReason(originalEvent);

  // Categorize the severity
  analysis.severity = categorizeSeverity(analysis);

  return analysis;
}

/**
 * Determine the likely reason for event processing failure
 * @param {Object} event - Original EventBridge event
 * @returns {string} Likely failure reason
 */
function determineFailureReason(event) {
  // Check for common failure patterns
  if (!event.detail) {
    return 'MISSING_EVENT_DETAIL';
  }

  if (!event.detail.customer) {
    return 'MISSING_CUSTOMER_ID';
  }

  if (!event.detail.id) {
    return 'MISSING_STRIPE_OBJECT_ID';
  }

  // Check for malformed data
  if (event['detail-type']?.startsWith('customer.subscription.') && !event.detail.status) {
    return 'MISSING_SUBSCRIPTION_STATUS';
  }

  if (event['detail-type']?.startsWith('invoice.payment_') && event.detail.paid === undefined) {
    return 'MISSING_PAYMENT_STATUS';
  }

  return 'PROCESSING_ERROR';
}

/**
 * Categorize the severity of a failed event
 * @param {Object} analysis - Event analysis
 * @returns {string} Severity level
 */
function categorizeSeverity(analysis) {
  // Critical: Payment failures or subscription deletions
  if (analysis.eventType === 'invoice.payment_failed' ||
      analysis.eventType === 'customer.subscription.deleted') {
    return 'CRITICAL';
  }

  // High: Missing customer data (affects tenant lookup)
  if (analysis.failureReason === 'MISSING_CUSTOMER_ID') {
    return 'HIGH';
  }

  // Medium: Data structure issues
  if (analysis.failureReason.startsWith('MISSING_')) {
    return 'MEDIUM';
  }

  // Low: General processing errors
  return 'LOW';
}

/**
 * Publish DLQ-specific metrics
 * @param {Object} eventAnalysis - Analysis of the failed event
 * @param {string} messageId - DLQ message ID
 */
async function publishDLQMetrics(eventAnalysis, messageId) {
  const dimensions = {
    EventType: eventAnalysis.eventType,
    EventSource: eventAnalysis.eventSource,
    FailureReason: eventAnalysis.failureReason,
    Severity: eventAnalysis.severity
  };

  await publishMetricEvent('event.failed', { dimensions }, messageId);

  // Publish severity-specific metrics
  await publishMetricEvent('event.failed', {
    dimensions: {
      ...dimensions,
      SeverityLevel: eventAnalysis.severity
    }
  }, messageId);
}

/**
 * Determine if an event requires immediate alert
 * @param {Object} eventAnalysis - Analysis of the failed event
 * @param {Object} messageAttributes - SQS message attributes
 * @returns {boolean} Whether to trigger immediate alert
 */
function shouldTriggerImmediateAlert(eventAnalysis, messageAttributes) {
  // Always alert for critical severity
  if (eventAnalysis.severity === 'CRITICAL') {
    return true;
  }

  // Alert if message has been retried multiple times
  const receiveCount = parseInt(messageAttributes?.ApproximateReceiveCount || '0');
  if (receiveCount > 3) {
    return true;
  }

  // Alert for payment-related failures
  if (eventAnalysis.eventType.includes('payment')) {
    return true;
  }

  return false;
}

/**
 * Trigger a critical alert for high-priority DLQ messages
 * @param {Object} eventAnalysis - Analysis of the failed event
 * @param {Object} messageAttributes - SQS message attributes
 * @param {Object} logger - Structured logger instance
 */
async function triggerCriticalAlert(eventAnalysis, messageAttributes, logger) {
  const alertContext = {
    eventType: eventAnalysis.eventType,
    eventId: eventAnalysis.eventId,
    severity: eventAnalysis.severity,
    failureReason: eventAnalysis.failureReason,
    stripeObjectId: eventAnalysis.stripeObjectId,
    stripeCustomerId: eventAnalysis.stripeCustomerId?.substring(0, 8) + '...',
    receiveCount: messageAttributes?.ApproximateReceiveCount,
    requiresManualReview: true
  };

  logger.error('CRITICAL: EventBridge event requires immediate attention', null, alertContext);

  // Publish critical alert metric
  await publishMetricEvent('event.failed', {
    dimensions: {
      EventType: eventAnalysis.eventType,
      AlertLevel: 'CRITICAL',
      RequiresManualReview: 'true'
    }
  }, eventAnalysis.eventId);
}

/**
 * Example DLQ message structure:
 * {
 *   "Records": [
 *     {
 *       "messageId": "dlq-message-id",
 *       "receiptHandle": "receipt-handle",
 *       "body": "{\"id\":\"event-id\",\"detail-type\":\"customer.subscription.created\",\"source\":\"stripe\",\"detail\":{...}}",
 *       "attributes": {
 *         "ApproximateReceiveCount": "4",
 *         "ApproximateFirstReceiveTimestamp": "1640995200000"
 *       },
 *       "messageAttributes": {},
 *       "md5OfBody": "...",
 *       "eventSource": "aws:sqs",
 *       "eventSourceARN": "arn:aws:sqs:region:account:dlq-name",
 *       "awsRegion": "us-east-1"
 *     }
 *   ]
 * }
 */
