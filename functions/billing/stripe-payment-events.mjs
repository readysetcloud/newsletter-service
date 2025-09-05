/**
 * EventBridge Stripe Payment Event Handler
 *
 * Handles Stripe payment events delivered via EventBridge:
 * - invoice.payment_succeeded
 * - invoice.payment_failed
 *
 * Features:
 * - Idempotent processing using event IDs
 * - Payment status updates and user notifications
 * - Dunning mfor failed payments
 * - CloudWatch metrics publishing
 * - Structured error handling and logging
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { updateTenantUserGroupsByPriceId } from './manage-user-groups.mjs';
import {
  getSubscriptionRecord,
  atomicSubscriptionUpdate
} from './subscription-data.mjs';
import {
  getPlanByPriceId,
  SUBSCRIPTION_PLANS
} from './types.mjs';
import {
  createBillingEventContext,
  findTenantByCustomerId,
  publishPaymentMetric,
  handleBillingEventError
} from '../utils/eventbridge-utils.mjs';

const eventBridgeClient = new EventBridgeClient({});

/**
 * Sends user notification via EventBridge
 */
async function sendUserNotification(tenantId, userId, notificationType, notificationData, eventId) {
  try {
    const eventDetail = {
      tenantId,
      userId,
      type: notificationType,
      data: notificationData,
      timestamp: new Date().toISOString()
    };

    const params = {
      Entries: [
        {
          Source: 'newsletter.billing',
          DetailType: 'User Notification',
          Detail: JSON.stringify(eventDetail),
          EventBusName: 'default'
        }
      ]
    };

    await eventBridgeClient.send(new PutEventsCommand(params));

    console.log(`Sent ${notificationType} notification to user`, {
      tenantId,
      userId,
      notificationType,
      eventId
    });
  } catch (error) {
    console.error('Failed to send user notification:', {
      tenantId,
      userId,
      notificationType,
      error: error.message,
      eventId
    });
    // Don't throw - payment processing should continue even if notification fails
  }
}

/**
 * Handles successful payment events
 */
async function handlePaymentSucceeded(invoice, eventId) {
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;
  const amountPaid = invoice.amount_paid;
  const currency = invoice.currency;
  const paidAt = new Date(invoice.status_transitions?.paid_at * 1000 || Date.now()).toISOString();

  if (!subscriptionId) {
    console.log('Invoice not associated with subscription, skipping');
    return;
  }

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId, eventId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Get current subscription record
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);
  if (!currentSubscription) {
    throw new Error(`No subscription record found for tenant ${tenant.tenantId}`);
  }

  // Check for idempotency
  if (currentSubscription.lastPaymentEventId === eventId) {
    console.log(`Payment succeeded event ${eventId} already processed for tenant ${tenant.tenantId}`);
    return;
  }

  const wasInactive = currentSubscription.status !== 'active';

  // Update subscription status to active and record payment
  const updateData = {
    status: 'active',
    lastPaymentAmount: amountPaid,
    lastPaymentCurrency: currency,
    lastPaymentDate: paidAt,
    lastPaymentEventId: eventId,
    updatedAt: new Date().toISOString()
  };

  // Clear any past due indicators
  if (currentSubscription.status === 'past_due') {
    updateData.pastDueCleared = true;
    updateData.pastDueClearedAt = new Date().toISOString();
  }

  await atomicSubscriptionUpdate(tenant.tenantId, updateData, eventId);

  // Restore user groups if subscription was previously inactive
  if (wasInactive && currentSubscription.planId) {
    try {
      const stripePriceId = Object.values(SUBSCRIPTION_PLANS)
        .find(p => p.name.toLowerCase() === currentSubscription.planId)?.priceId;

      if (stripePriceId) {
        await updateTenantUserGroupsByPriceId(tenant.tenantId, null, stripePriceId);
        console.log(`Payment succeeded for tenant ${tenant.tenantId}, restored to plan ${currentSubscription.planId}`);
      }
    } catch (error) {
      console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
      // Don't throw error - payment processing should still succeed
    }
  }

  // Send payment confirmation notification
  await sendUserNotification(
    tenant.tenantId,
    tenant.userId || null,
    'PAYMENT_SUCCEEDED',
    {
      invoiceId: invoice.id,
      subscriptionId,
      amount: amountPaid,
      currency,
      paidAt,
      planName: currentSubscription.planId,
      wasRestored: wasInactive,
      nextBillingDate: currentSubscription.currentPeriodEnd
    },
    eventId
  );

  // Publish success metrics
  await publishPaymentMetric('succeeded', {
    status: 'paid',
    currency: currency,
    amountPaid: amountPaid
  }, tenant.tenantId, eventId);

  console.log(`Successfully processed payment.succeeded for tenant ${tenant.tenantId}, invoice ${invoice.id}`);
}

/**
 * Handles failed payment events
 */
async function handlePaymentFailed(invoice, eventId) {
  console.log('Processing invoice.payment_failed event:', invoice.id);

  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;
  const attemptCount = invoice.attempt_count || 1;
  const nextPaymentAttempt = invoice.next_payment_attempt
    ? new Date(invoice.next_payment_attempt * 1000).toISOString()
    : null;
  const failedAt = new Date().toISOString();

  if (!subscriptionId) {
    console.log('Invoice not associated with subscription, skipping');
    return;
  }

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId, eventId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Get current subscription record
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);
  if (!currentSubscription) {
    throw new Error(`No subscription record found for tenant ${tenant.tenantId}`);
  }

  // Check for idempotency
  if (currentSubscription.lastPaymentEventId === eventId) {
    console.log(`Payment failed event ${eventId} already processed for tenant ${tenant.tenantId}`);
    return;
  }

  // Update subscription status to past_due and record failure details
  const updateData = {
    status: 'past_due',
    lastPaymentFailedAt: failedAt,
    paymentAttemptCount: attemptCount,
    nextPaymentAttempt,
    lastPaymentEventId: eventId,
    updatedAt: failedAt
  };

  await atomicSubscriptionUpdate(tenant.tenantId, updateData, eventId);

  // Determine dunning management action based on attempt count
  const isFirstFailure = attemptCount === 1;
  const isFinalFailure = attemptCount >= 4; // Stripe typically tries 4 times

  let notificationType = 'PAYMENT_FAILED';
  let notificationData = {
    invoiceId: invoice.id,
    subscriptionId,
    attemptCount,
    nextPaymentAttempt,
    failedAt,
    planName: currentSubscription.planId,
    isFirstFailure,
    isFinalFailure
  };

  // Handle dunning management based on failure count
  if (isFinalFailure) {
    // Final failure - subscription will be cancelled
    notificationType = 'PAYMENT_FINAL_FAILURE';
    notificationData.action = 'subscription_will_be_cancelled';
    notificationData.message = 'Your subscription will be cancelled due to repeated payment failures. Please update your payment method to restore access.';

    console.log(`Final payment failure for tenant ${tenant.tenantId}, subscription will be cancelled`);
  } else if (attemptCount === 2) {
    // Second failure - send urgent notice
    notificationType = 'PAYMENT_RETRY_FAILED';
    notificationData.action = 'update_payment_method';
    notificationData.message = `Payment attempt ${attemptCount} failed. Please update your payment method to avoid service interruption.`;

    console.log(`Payment retry failed for tenant ${tenant.tenantId}, attempt ${attemptCount}`);
  } else {
    // First failure - gentle reminder
    notificationData.action = 'check_payment_method';
    notificationData.message = 'Your payment failed. We\'ll retry automatically, but please check your payment method.';

    console.log(`First payment failure for tenant ${tenant.tenantId}, will retry automatically`);
  }

  // Send payment failure notification
  await sendUserNotification(
    tenant.tenantId,
    tenant.userId || null,
    notificationType,
    notificationData,
    eventId
  );

  // Note: We don't immediately remove users from groups on payment failure
  // This gives them time to update payment method during the retry period
  // Groups will be removed when subscription is actually cancelled

  // Publish failure metrics
  await publishPaymentMetric('failed', {
    status: 'failed',
    currency: invoice.currency || 'usd',
    amountDue: invoice.amount_due || 0
  }, tenant.tenantId, eventId);

  console.log(`Successfully processed payment.failed for tenant ${tenant.tenantId}, invoice ${invoice.id}, attempt ${attemptCount}`);
}

/**
 * Main Lambda handler for EventBridge events
 */
export const handler = async (event) => {
  const context = createBillingEventContext(event);

  try {
    // Process event based on type
    const eventHandlers = {
      'invoice.payment_succeeded': () => handlePaymentSucceeded(context.eventData.paymentData, context.eventData.id),
      'invoice.payment_failed': () => handlePaymentFailed(context.eventData.paymentData, context.eventData.id)
    };

    const handler = eventHandlers[context.eventData.type];
    if (!handler) {
      context.logger.info(`Unhandled payment event type: ${context.eventData.type}`);
      return;
    }

    // Execute handler with timing and metrics
    await context.timeOperation('payment-processing', handler);

    context.logger.info(`Successfully processed ${context.eventData.type} event`);

  } catch (error) {
    await context.handleError(error, 'payment-event-processing');
  }
};
