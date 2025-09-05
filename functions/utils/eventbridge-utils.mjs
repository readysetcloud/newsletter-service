/**
 * EventBridge Event Processing Utilities
 *
 * Shared utilities for parsing EventBridge events, extracting Stripe data,
 * tenant lookup, CloudWatch metrics publishing, and error handling for billing events.
 */

import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { publishMetricEvent } from './cloudwatch-metrics.mjs';
import { createLogger } from './structured-logger.mjs';

const dynamoClient = new DynamoDBClient({});

/**
 * Parses and validates EventBridge event structure
 * @param {Object} event - EventBridge event
 * @returns {Object} Parsed event data with validation
 */
export function parseEventBridgeEvent(event) {
  const logger = createLogger(event.id);

  logger.info('Parsing EventBridge event', {
    eventId: event.id,
    eventType: event['detail-type'],
    source: event.source
  });

  // Validate required fields
  const requiredFields = ['id', 'detail-type', 'source', 'detail'];
  const missingFields = requiredFields.filter(field => !event[field]);

  if (missingFields.length > 0) {
    throw new Error(`Missing required EventBridge fields: ${missingFields.join(', ')}`);
  }

  // Validate event source
  if (event.source !== 'stripe') {
    throw new Error(`Unexpected event source: ${event.source}. Expected: stripe`);
  }

  // Extract event data
  const eventData = {
    id: event.id,
    type: event['detail-type'],
    source: event.source,
    timestamp: event.time ? new Date(event.time) : new Date(),
    region: event.region,
    account: event.account,
    detail: event.detail
  };

  logger.info('Successfully parsed EventBridge event', {
    eventId: eventData.id,
    eventType: eventData.type,
    hasDetail: !!eventData.detail
  });

  return eventData;
}

/**
 * Extracts Stripe subscription data from EventBridge event detail
 * @param {Object} eventDetail - EventBridge event detail containing Stripe data
 * @returns {Object} Extracted subscription data
 */
export function extractStripeSubscriptionData(eventDetail) {
  if (!eventDetail || typeof eventDetail !== 'object') {
    throw new Error('Invalid event detail: must be an object');
  }

  // Validate required Stripe subscription fields
  const requiredFields = ['id', 'customer', 'status'];
  const missingFields = requiredFields.filter(field => !eventDetail[field]);

  if (missingFields.length > 0) {
    throw new Error(`Missing required Stripe subscription fields: ${missingFields.join(', ')}`);
  }

  // Extract subscription data with safe defaults
  const subscriptionData = {
    id: eventDetail.id,
    customerId: eventDetail.customer,
    status: eventDetail.status,
    currentPeriodStart: eventDetail.current_period_start
      ? new Date(eventDetail.current_period_start * 1000).toISOString()
      : null,
    currentPeriodEnd: eventDetail.current_period_end
      ? new Date(eventDetail.current_period_end * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: eventDetail.cancel_at_period_end || false,
    canceledAt: eventDetail.canceled_at
      ? new Date(eventDetail.canceled_at * 1000).toISOString()
      : null,
    trialStart: eventDetail.trial_start
      ? new Date(eventDetail.trial_start * 1000).toISOString()
      : null,
    trialEnd: eventDetail.trial_end
      ? new Date(eventDetail.trial_end * 1000).toISOString()
      : null
  };

  // Extract price ID from subscription items
  if (eventDetail.items && eventDetail.items.data && eventDetail.items.data.length > 0) {
    const firstItem = eventDetail.items.data[0];
    if (firstItem.price && firstItem.price.id) {
      subscriptionData.priceId = firstItem.price.id;
      subscriptionData.productId = firstItem.price.product;
    }
  }

  return subscriptionData;
}

/**
 * Extracts Stripe payment/invoice data from EventBridge event detail
 * @param {Object} eventDetail - EventBridge event detail containing Stripe invoice data
 * @returns {Object} Extracted payment data
 */
export function extractStripePaymentData(eventDetail) {
  if (!eventDetail || typeof eventDetail !== 'object') {
    throw new Error('Invalid event detail: must be an object');
  }

  // Validate required Stripe invoice fields
  const requiredFields = ['id', 'customer'];
  const missingFields = requiredFields.filter(field => !eventDetail[field]);

  if (missingFields.length > 0) {
    throw new Error(`Missing required Stripe invoice fields: ${missingFields.join(', ')}`);
  }

  // Extract payment data
  const paymentData = {
    invoiceId: eventDetail.id,
    customerId: eventDetail.customer,
    subscriptionId: eventDetail.subscription,
    status: eventDetail.status,
    paid: eventDetail.paid || false,
    amountPaid: eventDetail.amount_paid || 0,
    amountDue: eventDetail.amount_due || 0,
    currency: eventDetail.currency || 'usd',
    periodStart: eventDetail.period_start
      ? new Date(eventDetail.period_start * 1000).toISOString()
      : null,
    periodEnd: eventDetail.period_end
      ? new Date(eventDetail.period_end * 1000).toISOString()
      : null,
    dueDate: eventDetail.due_date
      ? new Date(eventDetail.due_date * 1000).toISOString()
      : null,
    attemptCount: eventDetail.attempt_count || 0,
    nextPaymentAttempt: eventDetail.next_payment_attempt
      ? new Date(eventDetail.next_payment_attempt * 1000).toISOString()
      : null
  };

  // Extract charge information if available
  if (eventDetail.charge) {
    paymentData.chargeId = eventDetail.charge;
  }

  // Extract payment method information if available
  if (eventDetail.payment_intent && eventDetail.payment_intent.payment_method) {
    paymentData.paymentMethodId = eventDetail.payment_intent.payment_method;
  }

  return paymentData;
}

/**
 * Finds tenant by Stripe customer ID using GSI
 * @param {string} customerId - Stripe customer ID
 * @param {string} correlationId - Correlation ID for logging
 * @returns {Promise<Object|null>} Tenant record or null if not found
 */
export async function findTenantByCustomerId(customerId, correlationId) {
  const logger = createLogger(correlationId);

  if (!customerId) {
    throw new Error('Customer ID is required');
  }

  logger.info('Looking up tenant by Stripe customer ID', {
    customerId: customerId.substring(0, 8) + '...' // Log partial ID for privacy
  });

  try {
    const params = {
      TableName: process.env.TABLE_NAME,
      IndexName: 'StripeCustomerIndex',
      KeyConditionExpression: 'stripeCustomerId = :customerId',
      ExpressionAttributeValues: marshall({
        ':customerId': customerId
      }),
      Limit: 1 // We only expect one tenant per customer
    };

    const result = await dynamoClient.send(new QueryCommand(params));
    const items = result.Items?.map(item => unmarshall(item)) || [];
    const tenant = items[0] || null;

    if (tenant) {
      logger.info('Successfully found tenant by customer ID', {
        tenantId: tenant.tenantId,
        customerId: customerId.substring(0, 8) + '...'
      });
    } else {
      logger.warn('No tenant found for customer ID', {
        customerId: customerId.substring(0, 8) + '...'
      });
    }

    return tenant;
  } catch (error) {
    logger.error('Failed to find tenant by customer ID', error, {
      customerId: customerId.substring(0, 8) + '...'
    });
    throw new Error(`Failed to lookup tenant by customer ID: ${error.message}`);
  }
}

/**
 * Publishes billing-specific CloudWatch metrics
 * @param {string} eventType - Type of billing event
 * @param {string} status - Event processing status (success/failure)
 * @param {Object} dimensions - Additional metric dimensions
 * @param {string} correlationId - Correlation ID for logging
 */
export async function publishBillingMetric(eventType, status, dimensions = {}, correlationId) {
  const logger = createLogger(correlationId);

  try {
    const metricEventType = status === 'success' ? 'event.processed' : 'event.failed';

    const metricDimensions = {
      EventType: eventType,
      BillingComponent: 'EventBridge',
      ...dimensions
    };

    await publishMetricEvent(metricEventType, {
      dimensions: metricDimensions
    }, correlationId);

    logger.info('Published billing metric', {
      eventType,
      status,
      dimensions: metricDimensions
    });
  } catch (error) {
    logger.error('Failed to publish billing metric', error, {
      eventType,
      status,
      dimensions
    });
    // Don't throw - metrics publishing should not break main flow
  }
}

/**
 * Publishes subscription-specific metrics
 * @param {string} action - Subscription action (created/updated/deleted)
 * @param {Object} subscriptionData - Subscription data for dimensions
 * @param {string} tenantId - Tenant ID
 * @param {string} correlationId - Correlation ID for logging
 */
export async function publishSubscriptionMetric(action, subscriptionData, tenantId, correlationId) {
  const dimensions = {
    TenantId: tenantId,
    SubscriptionStatus: subscriptionData.status,
    Action: action
  };

  // Add plan information if available
  if (subscriptionData.planId) {
    dimensions.PlanId = subscriptionData.planId;
  }

  await publishBillingMetric(`subscription.${action}`, 'success', dimensions, correlationId);
}

/**
 * Publishes payment-specific metrics
 * @param {string} action - Payment action (succeeded/failed)
 * @param {Object} paymentData - Payment data for dimensions
 * @param {string} tenantId - Tenant ID
 * @param {string} correlationId - Correlation ID for logging
 */
export async function publishPaymentMetric(action, paymentData, tenantId, correlationId) {
  const dimensions = {
    TenantId: tenantId,
    PaymentStatus: paymentData.status,
    Action: action,
    Currency: paymentData.currency || 'usd'
  };

  // Add amount information for successful payments
  if (action === 'succeeded' && paymentData.amountPaid) {
    dimensions.AmountRange = getAmountRange(paymentData.amountPaid);
  }

  await publishBillingMetric(`payment.${action}`, 'success', dimensions, correlationId);
}

/**
 * Gets amount range for metrics (to avoid exposing exact amounts)
 * @param {number} amount - Amount in cents
 * @returns {string} Amount range category
 */
function getAmountRange(amount) {
  if (amount < 1000) return '0-10';
  if (amount < 5000) return '10-50';
  if (amount < 10000) return '50-100';
  if (amount < 25000) return '100-250';
  return '250+';
}

/**
 * Creates structured error context for billing events
 * @param {Error} error - Original error
 * @param {Object} eventData - Event data for context
 * @param {string} operation - Operation being performed
 * @returns {Object} Structured error context
 */
export function createBillingErrorContext(error, eventData, operation) {
  return {
    operation,
    eventId: eventData.id,
    eventType: eventData.type,
    stripeObjectId: eventData.detail?.id,
    stripeCustomerId: eventData.detail?.customer,
    errorName: error.name,
    errorMessage: error.message,
    timestamp: new Date().toISOString()
  };
}

/**
 * Handles billing event processing errors with proper logging and metrics
 * @param {Error} error - Error that occurred
 * @param {Object} eventData - EventBridge event data
 * @param {string} operation - Operation that failed
 * @param {string} correlationId - Correlation ID for logging
 */
export async function handleBillingEventError(error, eventData, operation, correlationId) {
  const logger = createLogger(correlationId);
  const errorContext = createBillingErrorContext(error, eventData, operation);

  logger.error(`Billing event processing failed: ${operation}`, error, errorContext);

  // Publish failure metric
  await publishBillingMetric(eventData.type, 'failure', {
    ErrorType: error.name || 'UnknownError',
    Operation: operation,
    ErrorMessage: error.message?.substring(0, 100) || 'Unknown error'
  }, correlationId);

  // Re-throw error to trigger EventBridge retry mechanism
  throw error;
}

/**
 * Validates EventBridge event for billing processing
 * @param {Object} event - EventBridge event
 * @returns {Object} Validated and parsed event data
 */
export function validateBillingEvent(event) {
  // Parse basic EventBridge structure
  const eventData = parseEventBridgeEvent(event);

  // Validate billing-specific event types
  const supportedEventTypes = [
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed'
  ];

  if (!supportedEventTypes.includes(eventData.type)) {
    throw new Error(`Unsupported billing event type: ${eventData.type}`);
  }

  // Validate Stripe object structure based on event type
  if (eventData.type.startsWith('customer.subscription.')) {
    eventData.subscriptionData = extractStripeSubscriptionData(eventData.detail);
  } else if (eventData.type.startsWith('invoice.payment_')) {
    eventData.paymentData = extractStripePaymentData(eventData.detail);
  }

  return eventData;
}

/**
 * Creates a billing event processing context with utilities
 * @param {Object} event - EventBridge event
 * @returns {Object} Processing context with utilities
 */
export function createBillingEventContext(event) {
  const eventData = validateBillingEvent(event);
  const logger = createLogger(eventData.id);

  return {
    eventData,
    logger,

    // Utility methods bound to this context
    findTenant: (customerId) => findTenantByCustomerId(customerId, eventData.id),

    publishMetric: (action, data, tenantId) => {
      if (eventData.subscriptionData) {
        return publishSubscriptionMetric(action, data, tenantId, eventData.id);
      } else if (eventData.paymentData) {
        return publishPaymentMetric(action, data, tenantId, eventData.id);
      }
    },

    handleError: (error, operation) =>
      handleBillingEventError(error, eventData, operation, eventData.id),

    // Timing utility
    timeOperation: async (operation, fn) => {
      const startTime = Date.now();
      try {
        const result = await fn();
        const duration = Date.now() - startTime;

        await publishMetricEvent('event.duration', {
          value: duration,
          dimensions: {
            EventType: eventData.type,
            Operation: operation,
            Success: 'true'
          }
        }, eventData.id);

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        await publishMetricEvent('event.duration', {
          value: duration,
          dimensions: {
            EventType: eventData.type,
            Operation: operation,
            Success: 'false'
          }
        }, eventData.id);

        throw error;
      }
    }
  };
}

/**
 * Example usage:
 *
 * // In a billing event handler Lambda function:
 * export const handler = async (event) => {
 *   const context = createBillingEventContext(event);
 *
 *   try {
 *     const tenant = await context.findTenant(context.eventData.subscriptionData.customerId);
 *
 *     await context.timeOperation('update-subscription', async () => {
 *       // Update subscription logic here
 *     });
 *
 *     await context.publishMetric('updated', subscriptionData, tenant.tenantId);
 *
 *   } catch (error) {
 *     await context.handleError(error, 'subscription-update');
 *   }
 * };
 */
