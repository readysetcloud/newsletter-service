import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createLogger } from './structured-logger.mjs';
import { randomUUID } from 'crypto';

const eventBridge = new EventBridgeClient();

// Event types for different newsletter operations
export const EVENT_TYPES = {
  /**
   * The rendered issue has been handed to the send path — NOT that anybody has
   * received it.
   *
   * For a scheduled issue the workflow runs up to `IssueSendLeadTimeMinutes`
   * (currently 1,560 — twenty-six hours) before the send instant, and a local
   * send goes out timezone by timezone for hours after that. The name used to
   * be `ISSUE_PUBLISHED`, which read like a completed send and was taken for
   * one: in-app notifications shipped a draft that told tenants their issue had
   * gone out a day early. `Issue Send Completed`, raised by send-progress.mjs,
   * is the event that means delivery finished.
   */
  ISSUE_HANDED_OFF: 'Issue Handed Off',
  ISSUE_DRAFT_SAVED: 'ISSUE_DRAFT_SAVED',
  ISSUE_AB_COMPLETED: 'ISSUE_AB_COMPLETED',
  SUBSCRIBER_ADDED: 'Subscriber Added',
  SUBSCRIBER_REMOVED: 'Subscriber Removed',
  BRAND_UPDATED: 'Brand Updated',
  SYSTEM_ALERT: 'System Alert'
};

/**
 * Publishes an event to EventBridge
 * @param {string} source - Event source (e.g., 'newsletter-service')
 * @param {string} detailType - Event detail type
 * @param {Object} detail - Event detail payload
 * @param {string} correlationId - Optional correlation ID for tracing
 * @returns {Promise<void>}
 */
export const publishEvent = async (source, detailType, detail, correlationId = null) => {
  const eventCorrelationId = correlationId || randomUUID();
  const logger = createLogger(eventCorrelationId, detail.tenantId, detail.userId);

  const startTime = Date.now();

  try {
    logger.eventProcessing(detailType, 'start', {
      source,
      eventData: detail
    });

    const eventEntry = {
      Source: source,
      DetailType: detailType,
      Detail: JSON.stringify({
        ...detail,
        correlationId: eventCorrelationId,
        timestamp: new Date().toISOString()
      })
    };

    await eventBridge.send(new PutEventsCommand({
      Entries: [eventEntry]
    }));

    const duration = Date.now() - startTime;

    logger.eventProcessing(detailType, 'success', {
      source,
      durationMs: duration,
      eventSize: JSON.stringify(eventEntry).length
    });

    logger.metric('EventBridge.PublishEvent', duration, {
      source,
      detailType,
      success: true
    });

  } catch (error) {
    const duration = Date.now() - startTime;

    logger.eventProcessing(detailType, 'failure', {
      source,
      durationMs: duration,
      error
    });

    logger.metric('EventBridge.PublishEvent', duration, {
      source,
      detailType,
      success: false,
      errorType: error.name
    });

    // Don't throw error to avoid breaking the main operation
  }
};

/**
 * Publishes issue-related events
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @param {string} eventType - Event type from EVENT_TYPES
 * @param {Object} data - Issue data
 * @param {string} correlationId - Optional correlation ID for tracing
 * @returns {Promise<void>}
 */
export const publishIssueEvent = async (tenantId, userId, eventType, data, correlationId = null) => {
  await publishEvent('newsletter-service', eventType, {
    tenantId,
    userId,
    type: eventType.replace(/ /g, '_').toUpperCase(),
    data
  }, correlationId);
};

/**
 * Publishes subscriber-related events
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID (optional for some subscriber events)
 * @param {string} eventType - Event type from EVENT_TYPES
 * @param {Object} data - Subscriber data
 * @param {string} correlationId - Optional correlation ID for tracing
 * @returns {Promise<void>}
 */
export const publishSubscriberEvent = async (tenantId, userId, eventType, data, correlationId = null) => {
  await publishEvent('newsletter-service', eventType, {
    tenantId,
    userId,
    type: eventType.replace(' ', '_').toUpperCase(),
    data
  }, correlationId);
};
