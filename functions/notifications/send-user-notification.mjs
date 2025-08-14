import { randomUUID } from 'crypto';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { AuthClient, TopicClient, CredentialProvider, ExpiresIn, GenerateDisposableToken, TopicPublish } from '@gomomento/sdk';

/**
 * EventBridge-triggered Lambda handler for user notification processing
 * Processes newsletter events, stores them in DynamoDB with TTL, and publishes to Momento for real-time delivery
 */
export const handler = async (event) => {
  const correlationId = randomUUID();

  console.log('Send User Notification Lambda triggered', {
    correlationId,
    eventSource: event.source,
    eventDetailType: event['detail-type'],
    timestamp: new Date().toISOString()
  });

  try {
    // Parse and validate the EventBridge event
    const eventDetail = parseAndValidateEvent(event, correlationId);

    // Process the notification (store in DynamoDB and publish to Momento)
    await processNotification(eventDetail, correlationId);

    console.log('User notification processed successfully', {
      correlationId,
      tenantId: eventDetail.tenantId,
      eventType: eventDetail.type,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Failed to process user notification event', {
      correlationId,
      error: error.message,
      stack: error.stack,
      event: JSON.stringify(event),
      timestamp: new Date().toISOString()
    });

    // Publish enhanced error notification with context
    await publishErrorNotification(error, event, correlationId, {
      operation: 'event_processing',
      component: 'send-user-notification',
      retryAttempt: 0,
      maxRetries: 0
    });

    // Don't throw - we don't want to trigger DLQ for transient failures
    // EventBridge will retry automatically
  }
};

/**
 * Parse and validate incoming EventBridge event
 * @param {object} event - EventBridge event
 * @param {string} correlationId - Correlation ID for logging
 * @returns {object} Parsed event detail
 */
function parseAndValidateEvent(event, correlationId) {
  console.log('Parsing EventBridge event', {
    correlationId,
    source: event.source,
    detailType: event['detail-type']
  });

  if (!event.detail) {
    throw new Error('Missing event detail in EventBridge event');
  }

  const detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;

  // Validate required fields
  if (!detail.tenantId) {
    throw new Error('Missing tenantId in event detail');
  }

  if (!detail.type) {
    throw new Error('Missing event type in event detail');
  }

  if (!detail.data) {
    throw new Error('Missing event data in event detail');
  }

  console.log('Event parsed successfully', {
    correlationId,
    tenantId: detail.tenantId,
    eventType: detail.type,
    userId: detail.userId || 'unknown'
  });

  return {
    tenantId: detail.tenantId,
    userId: detail.userId,
    type: detail.type,
    data: detail.data,
    timestamp: detail.timestamp || new Date().toISOString(),
    source: event.source,
    detailType: event['detail-type']
  };
}

/**
 * Process notification by storing in DynamoDB and publishing to Momento
 * @param {object} eventDetail - Parsed event detail
 * @param {string} correlationId - Correlation ID for logging
 */
async function processNotification(eventDetail, correlationId) {
  console.log('Processing user notification', {
    correlationId,
    tenantId: eventDetail.tenantId,
    userId: eventDetail.userId,
    eventType: eventDetail.type
  });

  try {
    // Format notification for storage and delivery
    const notification = formatNotificationForEventType(eventDetail, correlationId);

    // Store notification in DynamoDB with TTL and unread status
    if (process.env.TABLE_NAME && eventDetail.userId) {
      await retryOperation(
        async () => {
          await storeNotificationInDynamoDB(notification, eventDetail.tenantId, eventDetail.userId, correlationId);
        },
        3, // maxRetries
        1000, // initial delay in ms
        correlationId,
        {
          operation: 'notification_storage',
          component: 'dynamodb-storage',
          tenantId: eventDetail.tenantId,
          userId: eventDetail.userId
        }
      );

      console.log('Notification stored in DynamoDB', {
        correlationId,
        tenantId: eventDetail.tenantId,
        userId: eventDetail.userId,
        notificationId: notification.id
      });
    } else {
      console.warn('DynamoDB not available or no userId provided, skipping notification storage', {
        correlationId,
        tenantId: eventDetail.tenantId,
        userId: eventDetail.userId,
        tableNameConfigured: !!process.env.TABLE_NAME
      });
    }

    // Publish to Momento for real-time delivery (if available)
    if (process.env.MOMENTO_API_KEY) {
      await publishToMomento(notification, eventDetail.tenantId, correlationId);
    } else {
      console.warn('Momento not available, skipping real-time notification delivery', {
        correlationId,
        tenantId: eventDetail.tenantId,
        notificationId: notification.id
      });
    }

    console.log('User notification processed successfully', {
      correlationId,
      tenantId: eventDetail.tenantId,
      userId: eventDetail.userId,
      notificationId: notification.id,
      type: notification.type
    });

  } catch (error) {
    console.error('Failed to process user notification', {
      correlationId,
      tenantId: eventDetail.tenantId,
      userId: eventDetail.userId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Store notification in DynamoDB with TTL and unread status
 * @param {object} notification - The notification object to store
 * @param {string} tenantId - Tenant ID for partitioning
 * @param {string} userId - User ID for the notification
 * @param {string} correlationId - Correlation ID for logging
 */
async function storeNotificationInDynamoDB(notification, tenantId, userId, correlationId) {
  try {
    // Calculate TTL (7 days from now)
    const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

    const item = {
      pk: `${tenantId}#${userId}`,
      sk: `NOTIFICATION#${notification.timestamp}#${notification.id}`,
      GSI1PK: `${tenantId}#notifications`,
      GSI1SK: `${notification.timestamp}#${notification.id}`,

      // Notification data
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      priority: notification.priority,
      actions: notification.actions || [],
      icon: notification.icon,

      // Metadata
      tenantId,
      userId,
      timestamp: notification.timestamp,
      correlationId: notification.correlationId,
      source: notification.source,
      version: notification.version || '1.0',

      // Status tracking
      status: 'unread',
      createdAt: new Date().toISOString(),
      ttl
    };

    const dynamoClient = new DynamoDBClient({});
    const command = new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(item)
    });

    await dynamoClient.send(command);

    console.log('Notification stored in DynamoDB', {
      correlationId,
      notificationId: notification.id,
      tenantId,
      userId,
      ttl: new Date(ttl * 1000).toISOString()
    });

  } catch (error) {
    console.error('Failed to store notification in DynamoDB', {
      correlationId,
      error: error.message,
      notificationId: notification.id,
      tenantId,
      userId
    });

    // Log structured error for DynamoDB storage failures (avoid recursive error notifications)
    logStructuredError(error, {
      source: 'send-user-notification',
      'detail-type': 'Notification Storage',
      detail: {
        tenantId,
        userId,
        type: 'NOTIFICATION_STORAGE_FAILED',
        data: { notificationId: notification.id, notificationType: notification.type }
      }
    }, correlationId, { tenantId, userId, eventType: 'NOTIFICATION_STORAGE_FAILED', eventData: { notificationId: notification.id, notificationType: notification.type }, eventSource: 'send-user-notification', eventDetailType: 'Notification Storage' }, {
      operation: 'notification_storage',
      component: 'dynamodb-storage',
      tenantId,
      userId,
      notificationId: notification.id
    });

    throw error;
  }
}

/**
 * Publish notification to Momento for real-time delivery
 * @param {object} notification - Formatted notification object
 * @param {string} tenantId - Tenant ID for channel scoping
 * @param {string} correlationId - Correlation ID for logging
 */
async function publishToMomento(notification, tenantId, correlationId) {
  console.log('Publishing notification to Momento for real-time delivery', {
    correlationId,
    tenantId,
    notificationId: notification.id,
    type: notification.type
  });

  try {
    // Generate write token for Momento operations
    const writeToken = await generateMomentoWriteToken(tenantId, correlationId);

    // Publish to tenant channel with retry logic for transient failures
    await retryOperation(
      async () => {
        await publishNotificationToTenantChannel(writeToken, tenantId, notification, correlationId);
      },
      3, // maxRetries
      1000, // initial delay in ms
      correlationId,
      {
        operation: 'notification_publishing',
        component: 'momento-publisher',
        tenantId,
        notificationId: notification.id
      }
    );

    console.log('Notification published to Momento successfully', {
      correlationId,
      tenantId,
      notificationId: notification.id,
      type: notification.type
    });

  } catch (error) {
    console.error('Failed to publish notification to Momento after retries', {
      correlationId,
      tenantId,
      notificationId: notification.id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    // Log structured error for Momento publishing failures (avoid recursive error notifications)
    logStructuredError(error, {
      source: 'send-user-notification',
      'detail-type': 'Notification Publishing',
      detail: {
        tenantId,
        type: 'NOTIFICATION_PUBLISHING_FAILED',
        data: { notificationId: notification.id, notificationType: notification.type }
      }
    }, correlationId, { tenantId, userId: null, eventType: 'NOTIFICATION_PUBLISHING_FAILED', eventData: { notificationId: notification.id, notificationType: notification.type }, eventSource: 'send-user-notification', eventDetailType: 'Notification Publishing' }, {
      operation: 'notification_publishing',
      component: 'momento-publisher',
      tenantId,
      notificationId: notification.id
    });

    throw new Error(`Momento notification publishing failed: ${error.message}`);
  }
}

/**
 * Generate a write-enabled Momento token for publishing notifications
 * @param {string} tenantId - Tenant ID for scoping permissions
 * @param {string} correlationId - Correlation ID for logging
 * @returns {Promise<string>} Generated Momento auth token
 */
async function generateMomentoWriteToken(tenantId, correlationId) {
  console.log('Generating Momento write token', {
    correlationId,
    tenantId
  });

  try {
    const authClient = new AuthClient({
      credentialProvider: CredentialProvider.fromString(process.env.MOMENTO_API_KEY)
    });

    const permissions = [
      {
        role: 'publishonly',
        cache: process.env.MOMENTO_CACHE_NAME,
        topic: tenantId
      }
    ];

    const tokenResponse = await authClient.generateDisposableToken(permissions, ExpiresIn.hours(1), { tokenId: tenantId });

    if (tokenResponse instanceof GenerateDisposableToken.Success) {
      console.log('Write token generated successfully', { correlationId, tenantId });
      return tokenResponse.authToken;
    } else {
      throw new Error(`Token generation failed: ${tokenResponse.message}`);
    }
  } catch (error) {
    console.error('Failed to generate Momento write token', {
      correlationId,
      tenantId,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    // Log structured error for token generation failures (avoid recursive error notifications)
    logStructuredError(error, {
      source: 'send-user-notification',
      'detail-type': 'Token Generation',
      detail: { tenantId, type: 'TOKEN_GENERATION_FAILED' }
    }, correlationId, { tenantId, userId: null, eventType: 'TOKEN_GENERATION_FAILED', eventData: {}, eventSource: 'send-user-notification', eventDetailType: 'Token Generation' }, {
      operation: 'token_generation',
      component: 'momento-write-token-generator',
      tenantId
    });

    throw new Error(`Momento write token generation failed: ${error.message}`);
  }
}

/**
 * Publish notification to tenant channel
 * @param {string} writeToken - Write-enabled Momento auth token
 * @param {string} tenantId - Tenant ID for channel scoping
 * @param {object} notification - Formatted notification
 * @param {string} correlationId - Correlation ID for logging
 */
async function publishNotificationToTenantChannel(writeToken, tenantId, notification, correlationId) {
  console.log('Publishing notification to tenant channel', {
    correlationId,
    tenantId,
    notificationType: notification.type
  });

  const cacheName = process.env.MOMENTO_CACHE_NAME || 'newsletter-notifications';
  const topicClient = new TopicClient({
    credentialProvider: CredentialProvider.fromString(writeToken)
  });

  try {
    const publishResponse = await topicClient.publish(cacheName, tenantId, JSON.stringify(notification));

    if (publishResponse instanceof TopicPublish.Success) {
      console.log(`Published to tenant channel: ${tenantId}`, {
        correlationId,
        tenantId,
        notificationType: notification.type
      });
    } else {
      throw new Error(`Publish failed: ${publishResponse.message}`);
    }
  } catch (error) {
    console.error(`Failed to publish to tenant channel: ${tenantId}`, {
      correlationId,
      tenantId,
      error: error.message,
      notificationType: notification.type
    });
    throw error; // Re-throw to trigger retry logic
  }
}



/**
 * Format notification based on event type for frontend consumption
 * Routes different event types to appropriate channels and formats data for UI components
 * @param {object} eventDetail - Parsed event detail
 * @param {string} correlationId - Correlation ID for logging
 * @returns {object} Formatted notification
 */
function formatNotificationForEventType(eventDetail, correlationId) {
  const baseNotification = {
    id: randomUUID(),
    correlationId,
    type: eventDetail.type,
    tenantId: eventDetail.tenantId,
    userId: eventDetail.userId,
    timestamp: eventDetail.timestamp,
    source: eventDetail.source,
    version: '1.0' // For future compatibility
  };

  // Route different event types to appropriate notification formats
  switch (eventDetail.type) {
    case 'ISSUE_PUBLISHED':
      return {
        ...baseNotification,
        title: 'New Issue Published',
        message: `Issue "${eventDetail.data.title}" has been published to ${eventDetail.data.subscriberCount || 0} subscribers`,
        data: {
          issueId: eventDetail.data.issueId,
          title: eventDetail.data.title,
          publishedAt: eventDetail.data.publishedAt,
          subscriberCount: eventDetail.data.subscriberCount || 0,
          status: 'published',
          url: eventDetail.data.url || null
        },
        priority: 'high',
        actions: ['view_issue', 'share_issue'],
        icon: 'publish'
      };

    case 'ISSUE_DRAFT_SAVED':
      return {
        ...baseNotification,
        title: 'Draft Saved',
        message: `Draft "${eventDetail.data.title}" has been saved`,
        data: {
          issueId: eventDetail.data.issueId,
          title: eventDetail.data.title,
          savedAt: eventDetail.data.savedAt,
          status: 'draft',
          wordCount: eventDetail.data.wordCount || null
        },
        priority: 'low',
        actions: ['edit_draft', 'preview_draft'],
        icon: 'save'
      };

    case 'SUBSCRIBER_ADDED':
      return {
        ...baseNotification,
        title: 'New Subscriber',
        message: `New subscriber added! You now have ${eventDetail.data.totalSubscribers || 0} subscribers`,
        data: {
          subscriberEmail: eventDetail.data.subscriberEmail,
          totalSubscribers: eventDetail.data.totalSubscribers || 0,
          addedAt: eventDetail.data.addedAt,
          source: eventDetail.data.source || 'direct',
          growthRate: eventDetail.data.growthRate || null,
          previousCount: (eventDetail.data.totalSubscribers || 1) - 1
        },
        priority: 'medium',
        actions: ['view_subscribers', 'send_welcome'],
        icon: 'user_plus'
      };

    case 'SUBSCRIBER_REMOVED':
      return {
        ...baseNotification,
        title: 'Subscriber Removed',
        message: `A subscriber has ${eventDetail.data.reason || 'unsubscribed'}. You now have ${eventDetail.data.totalSubscribers || 0} subscribers`,
        data: {
          subscriberEmail: eventDetail.data.subscriberEmail,
          totalSubscribers: eventDetail.data.totalSubscribers || 0,
          removedAt: eventDetail.data.removedAt,
          reason: eventDetail.data.reason || 'unsubscribed',
          previousCount: (eventDetail.data.totalSubscribers || 0) + 1
        },
        priority: 'low',
        actions: ['view_subscribers', 'analyze_churn'],
        icon: 'user_minus'
      };

    case 'BRAND_UPDATED':
      return {
        ...baseNotification,
        title: 'Brand Updated',
        message: `Your brand settings have been updated`,
        data: {
          brandId: eventDetail.data.brandId,
          updatedFields: eventDetail.data.updatedFields || [],
          updatedAt: eventDetail.data.updatedAt,
          changes: eventDetail.data.changes || {},
          previousValues: eventDetail.data.previousValues || {}
        },
        priority: 'medium',
        actions: ['view_brand', 'preview_changes'],
        icon: 'palette'
      };

    case 'SYSTEM_ALERT':
      return {
        ...baseNotification,
        title: 'System Alert',
        message: eventDetail.data.message || 'System alert notification',
        data: {
          alertType: eventDetail.data.alertType || 'info',
          severity: eventDetail.data.severity || 'info',
          details: eventDetail.data.details || {},
          component: eventDetail.data.component || 'unknown',
          resolution: eventDetail.data.resolution || null,
          affectedFeatures: eventDetail.data.affectedFeatures || []
        },
        priority: eventDetail.data.severity === 'critical' ? 'critical' : 'high',
        actions: ['view_details', 'dismiss'],
        icon: 'alert'
      };

    case 'SYSTEM_ERROR':
      return {
        ...baseNotification,
        title: 'System Error',
        message: eventDetail.data.message || 'A system error has occurred',
        data: {
          error: eventDetail.data.error || 'Unknown error',
          component: eventDetail.data.component || 'unknown',
          severity: eventDetail.data.severity || 'error',
          details: eventDetail.data.details || {},
          stack: eventDetail.data.stack || null,
          originalEvent: eventDetail.data.originalEvent || null
        },
        priority: 'critical',
        actions: ['view_logs', 'report_issue'],
        icon: 'error'
      };

    default:
      console.warn('Unknown event type, using generic notification format', {
        correlationId,
        eventType: eventDetail.type,
        tenantId: eventDetail.tenantId
      });

      return {
        ...baseNotification,
        title: 'Notification',
        message: `Event of type ${eventDetail.type} occurred`,
        data: {
          ...eventDetail.data,
          eventType: eventDetail.type
        },
        priority: 'medium',
        actions: ['view_details'],
        icon: 'info'
      };
  }
}

/**
 * Enhanced error notification system for system alerts and Momento operation failures
 * Publishes comprehensive error notifications with retry logic and detailed context
 * @param {Error} error - The error that occurred
 * @param {object} originalEvent - The original EventBridge event
 * @param {string} correlationId - Correlation ID for logging
 * @param {object} context - Additional context about the error
 */
async function publishErrorNotification(error, originalEvent, correlationId, context = {}) {
  console.log('Publishing enhanced error notification', {
    correlationId,
    error: error.message,
    errorType: error.constructor.name,
    component: context.component || 'send-user-notification',
    timestamp: new Date().toISOString()
  });

  try {
    // Extract tenant ID and user context from original event
    const eventContext = extractEventContext(originalEvent, correlationId);

    // Only attempt error notification if Momento is available
    if (!process.env.MOMENTO_API_KEY) {
      console.warn('Momento not available, logging error notification locally', {
        correlationId,
        error: error.message,
        tenantId: eventContext.tenantId,
        userId: eventContext.userId
      });

      // Log structured error for external monitoring systems
      logStructuredError(error, originalEvent, correlationId, eventContext, context);
      return;
    }

    // Create comprehensive error notification with retry logic
    await retryOperation(
      async () => {
        await publishSystemErrorNotification(error, originalEvent, correlationId, eventContext, context);
      },
      3, // maxRetries for error notifications
      500, // shorter delay for error notifications (500ms)
      correlationId,
      {
        operation: 'error_notification_publishing',
        component: 'error-notification-system',
        tenantId: eventContext.tenantId,
        userId: eventContext.userId
      }
    );

    console.log('Error notification published successfully', {
      correlationId,
      errorType: error.constructor.name,
      tenantId: eventContext.tenantId,
      component: context.component || 'send-user-notification',
      timestamp: new Date().toISOString()
    });

  } catch (errorNotificationError) {
    // Log but don't throw - we don't want error notification failures to cascade
    console.error('Failed to publish error notification after retries', {
      correlationId,
      originalError: error.message,
      errorNotificationError: errorNotificationError.message,
      timestamp: new Date().toISOString()
    });

    // Fallback to structured logging for monitoring systems
    logStructuredError(error, originalEvent, correlationId,
      extractEventContext(originalEvent, correlationId), context);
  }
}

/**
 * Extract event context including tenant ID, user ID, and event details
 * @param {object} originalEvent - The original EventBridge event
 * @param {string} correlationId - Correlation ID for logging
 * @returns {object} Extracted event context
 */
function extractEventContext(originalEvent, correlationId) {
  let tenantId = 'system';
  let userId = null;
  let eventType = null;
  let eventData = {};

  try {
    const detail = typeof originalEvent.detail === 'string'
      ? JSON.parse(originalEvent.detail)
      : originalEvent.detail;

    tenantId = detail?.tenantId || 'system';
    userId = detail?.userId || null;
    eventType = detail?.type || null;
    eventData = detail?.data || {};

    console.log('Extracted event context for error notification', {
      correlationId,
      tenantId,
      userId,
      eventType,
      hasEventData: Object.keys(eventData).length > 0
    });

  } catch (parseError) {
    console.warn('Could not extract full context from original event for error notification', {
      correlationId,
      parseError: parseError.message,
      eventSource: originalEvent.source,
      eventDetailType: originalEvent['detail-type']
    });
  }

  return {
    tenantId,
    userId,
    eventType,
    eventData,
    eventSource: originalEvent.source,
    eventDetailType: originalEvent['detail-type']
  };
}

/**
 * Publish system error notification to dedicated error channels
 * @param {Error} error - The error that occurred
 * @param {object} originalEvent - The original EventBridge event
 * @param {string} correlationId - Correlation ID for logging
 * @param {object} eventContext - Extracted event context
 * @param {object} context - Additional error context
 */
async function publishSystemErrorNotification(error, originalEvent, correlationId, eventContext, context) {
  // Generate write token for system error notifications
  const writeToken = await generateMomentoWriteToken('system', correlationId);

  // Determine error severity based on error type and context
  const severity = determineErrorSeverity(error, context);

  // Create comprehensive error notification
  const errorNotification = {
    id: randomUUID(),
    correlationId,
    type: 'SYSTEM_ERROR',
    tenantId: eventContext.tenantId,
    userId: eventContext.userId,
    timestamp: new Date().toISOString(),
    source: 'send-user-notification',
    version: '1.0',
    title: 'System Error Alert',
    message: `${context.operation || 'System operation'} failed: ${error.message}`,
    data: {
      error: {
        message: error.message,
        type: error.constructor.name,
        stack: error.stack,
        code: error.code || null
      },
      context: {
        operation: context.operation || 'unknown',
        component: context.component || 'send-user-notification',
        severity,
        retryAttempt: context.retryAttempt || 0,
        maxRetries: context.maxRetries || 0
      },
      originalEvent: {
        source: eventContext.eventSource,
        detailType: eventContext.eventDetailType,
        type: eventContext.eventType,
        tenantId: eventContext.tenantId,
        userId: eventContext.userId,
        data: eventContext.eventData
      },
      system: {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'unknown',
        region: process.env.AWS_REGION || 'unknown',
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
        functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION || 'unknown'
      }
    },
    priority: severity === 'critical' ? 'critical' : 'high',
    actions: ['view_logs', 'retry_operation', 'escalate'],
    icon: 'error'
  };

  // Publish to multiple channels for comprehensive error tracking
  const errorChannels = getErrorNotificationChannels(eventContext.tenantId, severity);

  console.log('Publishing system error to channels', {
    correlationId,
    channels: errorChannels,
    severity,
    errorType: error.constructor.name,
    tenantId: eventContext.tenantId
  });

  // Publish to all error channels
  const publishPromises = errorChannels.map(async (channel) => {
    try {
      await publishNotificationToTenantChannel(writeToken, channel, errorNotification, correlationId);
      console.log(`Error notification published to channel: ${channel}`, {
        correlationId,
        channel,
        severity,
        tenantId: eventContext.tenantId
      });
    } catch (publishError) {
      console.error(`Failed to publish error notification to channel: ${channel}`, {
        correlationId,
        channel,
        publishError: publishError.message,
        originalError: error.message
      });
      throw publishError; // Re-throw to trigger retry logic
    }
  });

  // Wait for all error notifications to be published
  await Promise.all(publishPromises);
}

/**
 * Determine error severity based on error type and context
 * @param {Error} error - The error that occurred
 * @param {object} context - Additional error context
 * @returns {string} Error severity level
 */
function determineErrorSeverity(error, context) {
  // Critical errors that affect system functionality
  if (error.message.includes('MOMENTO_API_KEY') ||
      error.message.includes('authentication') ||
      error.message.includes('authorization') ||
      context.operation === 'token_generation') {
    return 'critical';
  }

  // High priority errors for notification publishing failures
  if (error.message.includes('publish') ||
      error.message.includes('connection') ||
      context.operation === 'notification_publishing') {
    return 'high';
  }

  // Medium priority for data processing errors
  if (error.message.includes('parse') ||
      error.message.includes('validation') ||
      context.operation === 'event_processing') {
    return 'medium';
  }

  // Default to high for unknown errors
  return 'high';
}

/**
 * Get appropriate channels for error notifications based on tenant and severity
 * @param {string} tenantId - Tenant ID
 * @param {string} severity - Error severity level
 * @returns {string[]} Array of channel names for error notifications
 */
function getErrorNotificationChannels(tenantId, severity) {
  const channels = [];

  // Always publish to global system error channel
  channels.push('system-errors');

  // Add tenant-specific error channel if not system-level error
  if (tenantId && tenantId !== 'system') {
    channels.push(`${tenantId}-system-errors`);

    // For critical errors, also publish to main tenant channel
    if (severity === 'critical') {
      channels.push(`${tenantId}-system`);
    }
  }

  // Add severity-specific channels for monitoring and alerting
  channels.push(`system-errors-${severity}`);

  return [...new Set(channels)]; // Remove duplicates
}

/**
 * Log structured error information for external monitoring systems
 * @param {Error} error - The error that occurred
 * @param {object} originalEvent - The original EventBridge event
 * @param {string} correlationId - Correlation ID for logging
 * @param {object} eventContext - Extracted event context
 * @param {object} context - Additional error context
 */
function logStructuredError(error, originalEvent, correlationId, eventContext, context) {
  const structuredError = {
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    correlationId,
    error: {
      message: error.message,
      type: error.constructor.name,
      stack: error.stack,
      code: error.code || null
    },
    context: {
      operation: context.operation || 'unknown',
      component: context.component || 'send-user-notification',
      severity: determineErrorSeverity(error, context),
      retryAttempt: context.retryAttempt || 0,
      maxRetries: context.maxRetries || 0
    },
    event: {
      source: eventContext.eventSource,
      detailType: eventContext.eventDetailType,
      type: eventContext.eventType,
      tenantId: eventContext.tenantId,
      userId: eventContext.userId
    },
    system: {
      environment: process.env.NODE_ENV || 'unknown',
      region: process.env.AWS_REGION || 'unknown',
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown'
    }
  };

  // Log as JSON for structured logging systems (CloudWatch, etc.)
  console.error('STRUCTURED_ERROR', JSON.stringify(structuredError));
}

/**
 * Enhanced retry logic for transient failures with error notification support
 * @param {Function} operation - The operation to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delayMs - Delay between retries in milliseconds
 * @param {string} correlationId - Correlation ID for logging
 * @param {object} context - Additional context for error notifications
 * @returns {Promise<any>} Result of the operation
 */
async function retryOperation(operation, maxRetries = 3, delayMs = 1000, correlationId, context = {}) {
  let lastError;
  const operationStartTime = Date.now();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting operation (attempt ${attempt}/${maxRetries})`, {
        correlationId,
        attempt,
        maxRetries,
        operation: context.operation || 'unknown',
        component: context.component || 'unknown'
      });

      const result = await operation();

      // Log successful retry if it wasn't the first attempt
      if (attempt > 1) {
        console.log(`Operation succeeded after ${attempt} attempts`, {
          correlationId,
          attempt,
          maxRetries,
          totalDuration: Date.now() - operationStartTime,
          operation: context.operation || 'unknown'
        });
      }

      return result;
    } catch (error) {
      lastError = error;

      console.warn(`Operation failed on attempt ${attempt}`, {
        correlationId,
        attempt,
        maxRetries,
        error: error.message,
        errorType: error.constructor.name,
        operation: context.operation || 'unknown',
        component: context.component || 'unknown'
      });

      // Log structured error for persistent failures (after 2nd attempt) - avoid recursion
      if (attempt >= 2) {
        logStructuredError(error, {
          source: 'send-user-notification',
          'detail-type': 'Retry Operation',
          detail: {
            tenantId: context.tenantId || 'system',
            userId: context.userId || null,
            type: 'OPERATION_RETRY_FAILED',
            data: {
              operation: context.operation || 'unknown',
              attempt,
              maxRetries,
              component: context.component || 'unknown'
            }
          }
        }, correlationId, { tenantId: context.tenantId || 'system', userId: context.userId || null, eventType: 'OPERATION_RETRY_FAILED', eventData: { operation: context.operation || 'unknown', attempt, maxRetries }, eventSource: 'send-user-notification', eventDetailType: 'Retry Operation' }, {
          operation: context.operation || 'retry_operation',
          component: context.component || 'retry-handler',
          retryAttempt: attempt,
          maxRetries,
          tenantId: context.tenantId,
          userId: context.userId
        });
      }

      // Don't delay on the last attempt
      if (attempt < maxRetries) {
        console.log(`Retrying in ${delayMs}ms`, {
          correlationId,
          delayMs,
          nextAttempt: attempt + 1,
          operation: context.operation || 'unknown'
        });

        await new Promise(resolve => setTimeout(resolve, delayMs));
        // Exponential backoff with jitter to prevent thundering herd
        delayMs = Math.floor(delayMs * 2 * (0.5 + Math.random() * 0.5));
      }
    }
  }

  const totalDuration = Date.now() - operationStartTime;
  console.error(`Operation failed after ${maxRetries} attempts`, {
    correlationId,
    maxRetries,
    finalError: lastError.message,
    errorType: lastError.constructor.name,
    totalDuration,
    operation: context.operation || 'unknown',
    component: context.component || 'unknown'
  });

  // Log structured error for final failure (avoid recursion)
  logStructuredError(lastError, {
    source: 'send-user-notification',
    'detail-type': 'Operation Final Failure',
    detail: {
      tenantId: context.tenantId || 'system',
      userId: context.userId || null,
      type: 'OPERATION_FINAL_FAILURE',
      data: {
        operation: context.operation || 'unknown',
        maxRetries,
        totalDuration,
        component: context.component || 'unknown'
      }
    }
  }, correlationId, { tenantId: context.tenantId || 'system', userId: context.userId || null, eventType: 'OPERATION_FINAL_FAILURE', eventData: { operation: context.operation || 'unknown', maxRetries, totalDuration }, eventSource: 'send-user-notification', eventDetailType: 'Operation Final Failure' }, {
    operation: context.operation || 'final_failure',
    component: context.component || 'retry-handler',
    retryAttempt: maxRetries,
    maxRetries,
    tenantId: context.tenantId,
    userId: context.userId
  });

  throw lastError;
}
