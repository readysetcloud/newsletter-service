import { randomUUID } from 'crypto';
import { DynamoDBClient, PutItemCommand } frws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { nonBlockingMomentoClient } from '../utils/non-blocking-momento.mjs';
import { createMetricsContext } from '../utils/cloudwatch-metrics.mjs';

/**
 * Non-blocking EventBridge-triggered Lambda handler for user notification processing
 * Processes newsletter events, stores them in DynamoDB with TTL, and publishes to Momento for real-time delivery
 * Uses timeouts and graceful degradation to prevent blocking the main thread
 */
export const handler = async (event) => {
  const correlationId = randomUUID();
  const metrics = createMetricsContext(correlationId);

  console.log('Send User Notification Lambda triggered (non-blocking)', {
    correlationId,
    eventSource: event.source,
    eventDetailType: event['detail-type'],
    timestamp: new Date().toISOString()
  });

  try {
    // Parse and validate the EventBridge event
    const eventDetail = parseAndValidateEvent(event, correlationId);

    // Track API request
    metrics.addEvent('api.request', {
      dimensions: {
        FunctionName: 'SendUserNotification',
        EventType: eventDetail.type,
        TenantId: eventDetail.tenantId
      }
    });

    // Process the notification with non-blocking approach
    await processNotificationNonBlocking(eventDetail, correlationId, metrics);

    // Track success
    metrics.addEvent('notification.published', {
      dimensions: {
        TenantId: eventDetail.tenantId,
        EventType: eventDetail.type
      }
    });

    console.log('User notification processed successfully (non-blocking)', {
      correlationId,
      tenantId: eventDetail.tenantId,
      eventType: eventDetail.type,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    // Track error
    metrics.addEvent('notification.failed', {
      dimensions: {
        TenantId: event.detail?.tenantId || 'UNKNOWN',
        EventType: event.detail?.type || 'UNKNOWN',
        ErrorType: error.name || 'UNKNOWN_ERROR'
      }
    });

    console.error('Failed to process user notification event (non-blocking)', {
      correlationId,
      error: error.message,
      stack: error.stack,
      event: JSON.stringify(event),
      timestamp: new Date().toISOString()
    });

    // Publish error notification asynchronously (fire and forget)
    publishErrorNotificationAsync(error, event, correlationId).catch(err => {
      console.error('Failed to publish error notification', { correlationId, error: err.message });
    });

    throw error;
  } finally {
    // Publish metrics asynchronously
    metrics.publishAll().catch(err => {
      console.error('Failed to publish metrics', { correlationId, error: err.message });
    });
  }
};

/**
 * Parse and validate EventBridge event
 * @param {object} event - EventBridge event
 * @param {string} correlationId - Correlation ID for logging
 * @returns {object} Parsed event detail
 */
function parseAndValidateEvent(event, correlationId) {
  if (!event.detail) {
    throw new Error('Missing event detail in EventBridge event');
  }

  const { tenantId, userId, type, data } = event.detail;

  if (!tenantId) {
    throw new Error('Missing tenantId in event detail');
  }

  if (!type) {
    throw new Error('Missing notification type in event detail');
  }

  console.log('Event parsed and validated', {
    correlationId,
    tenantId,
    userId: userId || 'anonymous',
    type,
    hasData: !!data
  });

  return { tenantId, userId, type, data: data || {} };
}

/**
 * Process notification with non-blocking approach
 * @param {object} eventDetail - Parsed event detail
 * @param {string} correlationId - Correlation ID for logging
 * @param {object} metrics - Metrics context
 */
async function processNotificationNonBlocking(eventDetail, correlationId, metrics) {
  const { tenantId, userId, type, data } = eventDetail;

  // Create notification object
  const notification = createNotificationObject(eventDetail, correlationId);

  console.log('Processing notification with non-blocking approach', {
    correlationId,
    tenantId,
    userId: userId || 'anonymous',
    notificationId: notification.id,
    type
  });

  // Store in DynamoDB (this is critical and should not be skipped)
  await storeNotificationInDynamoDB(notification, tenantId, userId, correlationId);

  // Publish to Momento asynchronously with timeout and graceful failure
  // This runs in parallel and won't block the main thread
  publishToMomentoNonBlocking(notification, tenantId, correlationId, metrics)
    .catch(error => {
      console.warn('Momento publishing failed but continuing', {
        correlationId,
        tenantId,
        notificationId: notification.id,
        error: error.message
      });

      // Track the failure but don't throw
      metrics.addEvent('notification.failed', {
        dimensions: {
          TenantId: tenantId,
          EventType: type,
          ErrorType: 'MOMENTO_PUBLISH_FAILED'
        }
      });
    });

  console.log('Notification processing initiated (non-blocking)', {
    correlationId,
    tenantId,
    notificationId: notification.id,
    storedInDynamoDB: true,
    momentoPublishingAsync: true
  });
}

/**
 * Create notification object from event detail
 * @param {object} eventDetail - Parsed event detail
 * @param {string} correlationId - Correlation ID for logging
 * @returns {object} Formatted notification object
 */
function createNotificationObject(eventDetail, correlationId) {
  const { tenantId, userId, type, data } = eventDetail;

  const notification = {
    id: randomUUID(),
    type: type,
    title: data.title || getDefaultTitle(type),
    message: data.message || getDefaultMessage(type, data),
    timestamp: new Date().toISOString(),
    tenantId: tenantId,
    userId: userId || null,
    data: data,
    correlationId: correlationId
  };

  return notification;
}

/**
 * Get default title for notification type
 * @param {string} type - Notification type
 * @returns {string} Default title
 */
function getDefaultTitle(type) {
  const titleMap = {
    'USER_SIGNUP': 'Welcome!',
    'ISSUE_PUBLISHED': 'Newsletter Published',
    'SUBSCRIBER_ADDED': 'New Subscriber',
    'BRAND_UPDATED': 'Brand Updated',
    'API_KEY_CREATED': 'API Key Created',
    'SYSTEM_ALERT': 'System Alert'
  };

  return titleMap[type] || 'Notification';
}

/**
 * Get default message for notification type
 * @param {string} type - Notification type
 * @param {object} data - Notification data
 * @returns {string} Default message
 */
function getDefaultMessage(type, data) {
  const messageMap = {
    'USER_SIGNUP': 'Welcome to the newsletter service!',
    'ISSUE_PUBLISHED': `Newsletter "${data.issueTitle || 'Latest Issue'}" has been published.`,
    'SUBSCRIBER_ADDED': 'A new subscriber has joined your newsletter.',
    'BRAND_UPDATED': 'Your brand settings have been updated.',
    'API_KEY_CREATED': 'A new API key has been created.',
    'SYSTEM_ALERT': data.message || 'System alert notification.'
  };

  return messageMap[type] || 'You have a new notification.';
}

/**
 * Store notification in DynamoDB with TTL
 * @param {object} notification - Notification object
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @param {string} correlationId - Correlation ID for logging
 */
async function storeNotificationInDynamoDB(notification, tenantId, userId, correlationId) {
  const ddb = new DynamoDBClient();

  // Set TTL to 30 days from now
  const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

  const item = {
    pk: `TENANT#${tenantId}`,
    sk: `NOTIFICATION#${notification.id}`,
    GSI1PK: `USER#${userId || 'SYSTEM'}`,
    GSI1SK: `NOTIFICATION#${notification.timestamp}`,
    type: 'notification',
    notificationId: notification.id,
    notificationType: notification.type,
    title: notification.title,
    message: notification.message,
    timestamp: notification.timestamp,
    tenantId: tenantId,
    userId: userId || null,
    data: notification.data || {},
    correlationId: correlationId,
    ttl: ttl
  };

  try {
    const command = new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(item)
    });

    await ddb.send(command);

    console.log('Notification stored in DynamoDB', {
      correlationId,
      tenantId,
      userId: userId || 'anonymous',
      notificationId: notification.id,
      ttl: new Date(ttl * 1000).toISOString()
    });

  } catch (error) {
    console.error('Failed to store notification in DynamoDB', {
      correlationId,
      tenantId,
      userId: userId || 'anonymous',
      notificationId: notification.id,
      error: error.message
    });
    throw error;
  }
}

/**
 * Publish notification to Momento with non-blocking approach
 * @param {object} notification - Notification object
 * @param {string} tenantId - Tenant ID
 * @param {string} correlationId - Correlation ID for logging
 * @param {object} metrics - Metrics context
 * @returns {Promise<boolean>} Success status
 */
async function publishToMomentoNonBlocking(notification, tenantId, correlationId, metrics) {
  console.log('Publishing notification to Momento (non-blocking)', {
    correlationId,
    tenantId,
    notificationId: notification.id,
    type: notification.type
  });

  try {
    // Use the non-blocking client with timeout and retry
    const success = await nonBlockingMomentoClient.publishNotificationWithRetry(
      tenantId,
      notification,
      {
        maxRetries: 2,
        timeoutMs: 3000, // 3 second timeout
        retryDelayMs: 500 // 500ms between retries
      }
    );

    if (success) {
      console.log('Notification published to Momento successfully (non-blocking)', {
        correlationId,
        tenantId,
        notificationId: notification.id,
        type: notification.type
      });

      // Track success
      metrics.addEvent('momento.token.generated', {
        dimensions: { TenantId: tenantId }
      });

      return true;
    } else {
      console.warn('Notification publishing to Momento failed after retries (non-blocking)', {
        correlationId,
        tenantId,
        notificationId: notification.id
      });

      // Track failure
      metrics.addEvent('momento.token.failed', {
        dimensions: {
          TenantId: tenantId,
          ErrorType: 'PUBLISH_FAILED'
        }
      });

      return false;
    }

  } catch (error) {
    console.error('Unexpected error in Momento publishing (non-blocking)', {
      correlationId,
      tenantId,
      notificationId: notification.id,
      error: error.message
    });

    // Track error
    metrics.addEvent('momento.token.failed', {
      dimensions: {
        TenantId: tenantId,
        ErrorType: error.name || 'UNKNOWN_ERROR'
      }
    });

    return false;
  }
}

/**
 * Publish error notification asynchronously (fire and forget)
 * @param {Error} error - Error object
 * @param {object} originalEvent - Original EventBridge event
 * @param {string} correlationId - Correlation ID for logging
 * @returns {Promise<void>} Promise that resolves when done (or fails silently)
 */
async function publishErrorNotificationAsync(error, originalEvent, correlationId) {
  try {
    const tenantId = originalEvent.detail?.tenantId || 'UNKNOWN';

    const errorNotification = {
      id: randomUUID(),
      type: 'SYSTEM_ERROR',
      title: 'Notification Processing Error',
      message: `Failed to process notification: ${error.message}`,
      timestamp: new Date().toISOString(),
      tenantId: tenantId,
      userId: null,
      data: {
        originalEventType: originalEvent.detail?.type,
        errorMessage: error.message,
        errorStack: error.stack,
        correlationId: correlationId
      },
      correlationId: correlationId
    };

    // Store error notification in DynamoDB
    await storeNotificationInDynamoDB(errorNotification, tenantId, nullationId);

    // Try to publish to Momento (with short timeout)
    await nonBlockingMomentoClient.publishNotificationWithRetry(
      tenantId,
      errorNotification,
      {
        maxRetries: 1,
        timeoutMs: 2000, // Short timeout for error notifications
        retryDelayMs: 500
      }
    );

    console.log('Error notification published successfully', {
      correlationId,
      tenantId,
      errorNotificationId: errorNotification.id
    });

  } catch (publishError) {
    // Don't throw - this is fire and forget
    console.error('Failed to publish error notification (non-blocking)', {
      correlationId,
      originalError: error.message,
      publishError: publishError.message
    });
  }
}

/**
 * Usage notes:
 *
 * This non-blocking version of the notification service:
 *
 * 1. **Never blocks on Momento operations** - Uses timeouts and graceful degradation
 * 2. **Prioritizes DynamoDB storage** - Critical data is always stored
 * 3. **Publishes to Momento asynchronously** - Real-time features are nice-to-have
 * 4. **Uses token caching** - Reduces API calls and improves performance
 * 5. **Implements retry logic** - Handles transient failures gracefully
 * 6. **Provides comprehensive logging** - Easy to debug and monitor
 * 7. **Tracks metrics** - Monitors success/failure rates
 *
 * Benefits:
 * - Lambda function completes quickly even if Momento is slow/unavailable
 * - Users always get their notifications stored (in DynamoDB)
 * - Real-time features work when possible but don't break the system when they don't
 * - Better user experience with faster response times
 * - More resilient to external service failures
 */
