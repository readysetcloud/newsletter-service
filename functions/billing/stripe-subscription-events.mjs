/**
 * EventBridge Stripe Subscription Event Handler
 *
 * Handles Stripe subscription lifecycle events delivered via EventBridge:
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 *
 * Features:
 * - Idempotent processing using event IDs
 * - User group management integration
 * - CloudWatch metrics publishing
 * - Structured error handling and logging
 */

import { updateTenantUserGroupsByPriceId } from './manage-user-groups.mjs';
import {
  getSubscriptionRecord,
  updateSubscriptionStatus,
  atomicSubscriptionUpdate
} from './subscription-data.mjs';
import {
  getPlanByPriceId,
  isValidSubscriptionStatus,
  createSubscriptionRecord
} from './types.mjs';
import {
  createBillingEventContext,
  findTenantByCustomerId,
  publishSubscriptionMetric,
  handleBillingEventError
} from '../utils/eventbridge-utils.mjs';



/**
 * Handles subscription created events
 */
async function handleSubscriptionCreated(subscription, eventId) {
  const customerId = subscription.customerId;
  const subscriptionId = subscription.id;
  const status = subscription.status;
  const currentPeriodStart = subscription.currentPeriodStart;
  const currentPeriodEnd = subscription.currentPeriodEnd;
  const cancelAtPeriodEnd = subscription.cancelAtPeriodEnd;

  // Get plan ID from transformed subscription data
  const stripePriceId = subscription.priceId;
  if (!stripePriceId) {
    throw new Error('No price ID found in subscription');
  }

  const planId = getPlanByPriceId(stripePriceId);
  if (!planId) {
    throw new Error(`Unknown Stripe price ID: ${stripePriceId}`);
  }

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId, eventId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Create subscription record with idempotency
  const subscriptionData = createSubscriptionRecord({
    tenantId: tenant.tenantId,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerId,
    status,
    planId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd
  });

  // Add event tracking for idempotency
  subscriptionData.lastEventId = eventId;

  try {
    await atomicSubscriptionUpdate(tenant.tenantId, subscriptionData, eventId);
  } catch (error) {
    // Check if this is an idempotency skip
    if (error.message.includes('already processed')) {
      console.log(`Subscription created event ${eventId} already processed for tenant ${tenant.tenantId}`);
      return;
    }
    throw error;
  }

  // Update Cognito groups if subscription is active
  if (status === 'active') {
    try {
      await updateTenantUserGroupsByPriceId(tenant.tenantId, null, stripePriceId);
      console.log(`Successfully updated user groups for tenant ${tenant.tenantId} to plan ${planId}`);
    } catch (error) {
      console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
      // Don't throw error - subscription creation should still succeed
    }
  }

  // Publish success metric
  await publishSubscriptionMetric('created', { status, planId }, tenant.tenantId, eventId);

  console.log(`Successfully processed subscription.created for tenant ${tenant.tenantId}, subscription ${subscriptionId}`);
}

/**
 * Handles subscription updated events
 */
async function handleSubscriptionUpdated(subscription, eventId) {
  console.log('Processing subscription.updated event:', subscription.id);

  const customerId = subscription.customerId;
  const subscriptionId = subscription.id;
  const status = subscription.status;
  const currentPeriodStart = subscription.currentPeriodStart;
  const currentPeriodEnd = subscription.currentPeriodEnd;
  const cancelAtPeriodEnd = subscription.cancelAtPeriodEnd;
  const canceledAt = subscription.canceledAt;

  const stripePriceId = subscription.priceId;
  const planId = stripePriceId ? getPlanByPriceId(stripePriceId) : null;

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId, eventId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Get current subscription to compare status changes
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);
  if (!currentSubscription) {
    throw new Error(`No existing subscription record found for tenant ${tenant.tenantId}`);
  }

  // Check for idempotency
  if (currentSubscription.lastEventId === eventId) {
    console.log(`Subscription updated event ${eventId} already processed for tenant ${tenant.tenantId}`);
    return;
  }

  // Prepare subscription update data
  const subscriptionUpdateData = {
    stripeSubscriptionId: subscriptionId,
    status,
    planId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    lastEventId: eventId,
    updatedAt: new Date().toISOString()
  };

  // Handle cancellation-specific data
  if (cancelAtPeriodEnd && !currentSubscription?.cancelAtPeriodEnd) {
    // Subscription was just cancelled
    subscriptionUpdateData.canceledAt = canceledAt;
    subscriptionUpdateData.accessEndsAt = currentPeriodEnd;
    console.log(`Subscription cancelled for tenant ${tenant.tenantId}, access will end at ${currentPeriodEnd}`);
  } else if (!cancelAtPeriodEnd && currentSubscription?.cancelAtPeriodEnd) {
    // Cancellation was reversed
    subscriptionUpdateData.canceledAt = null;
    subscriptionUpdateData.accessEndsAt = null;
    console.log(`Subscription cancellation reversed for tenant ${tenant.tenantId}`);
  }

  // Update subscription record with idempotency
  await atomicSubscriptionUpdate(tenant.tenantId, subscriptionUpdateData, eventId);

  // Handle group changes based on status and plan changes
  try {
    const currentPlanId = currentSubscription.planId;
    const currentStatus = currentSubscription.status;

    if (status === 'active' && currentStatus !== 'active') {
      // Subscription became active - add to premium groups
      await updateTenantUserGroupsByPriceId(tenant.tenantId, null, stripePriceId);
      console.log(`Activated subscription for tenant ${tenant.tenantId}, updated to plan ${planId}`);
    } else if (status !== 'active' && currentStatus === 'active') {
      // Subscription became inactive - remove from premium groups (but not for cancellations that maintain access)
      if (!cancelAtPeriodEnd || status === 'canceled') {
        const { SUBSCRIPTION_PLANS } = await import('./types.mjs');
        const currentStripePriceId = Object.values(SUBSCRIPTION_PLANS)
          .find(p => p.name.toLowerCase() === currentPlanId)?.priceId;
        await updateTenantUserGroupsByPriceId(tenant.tenantId, currentStripePriceId, null);
        console.log(`Deactivated subscription for tenant ${tenant.tenantId}, downgraded to free plan`);
      }
    } else if (status === 'active' && planId !== currentPlanId) {
      // Plan changed - update groups
      const { SUBSCRIPTION_PLANS } = await import('./types.mjs');
      const currentStripePriceId = Object.values(SUBSCRIPTION_PLANS)
        .find(p => p.name.toLowerCase() === currentPlanId)?.priceId;
      await updateTenantUserGroupsByPriceId(tenant.tenantId, currentStripePriceId, stripePriceId);
      console.log(`Changed subscription plan for tenant ${tenant.tenantId}: ${currentPlanId} -> ${planId}`);
    }

    // Special handling for cancelled subscriptions that are still active
    if (cancelAtPeriodEnd && status === 'active' && !currentSubscription?.cancelAtPeriodEnd) {
      console.log(`Subscription cancelled but still active for tenant ${tenant.tenantId}, maintaining premium access until ${currentPeriodEnd}`);
    }
  } catch (error) {
    console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
    // Don't throw error - subscription update should still succeed
  }

  // Publish success metric
  await publishSubscriptionMetric('updated', { status, planId: planId || 'unknown' }, tenant.tenantId, eventId);

  console.log(`Successfully processed subscription.updated for tenant ${tenant.tenantId}, subscription ${subscriptionId}`);
}

/**
 * Handles subscription deleted events
 */
async function handleSubscriptionDeleted(subscription, eventId) {
  console.log('Processing subscription.deleted event:', subscription.id);

  const customerId = subscription.customerId;
  const deletedAt = new Date().toISOString();

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId, eventId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Get current subscription to get plan info
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);
  if (!currentSubscription) {
    console.warn(`No existing subscription record found for tenant ${tenant.tenantId} during deletion`);
    return;
  }

  // Check for idempotency
  if (currentSubscription.lastEventId === eventId) {
    console.log(`Subscription deleted event ${eventId} already processed for tenant ${tenant.tenantId}`);
    return;
  }

  // Update subscription record to deleted status
  const updateData = {
    status: 'deleted',
    deletedAt,
    lastEventId: eventId,
    updatedAt: deletedAt
  };

  await atomicSubscriptionUpdate(tenant.tenantId, updateData, eventId);

  // Remove users from premium groups (downgrade to free)
  if (currentSubscription?.planId && currentSubscription.planId !== 'free') {
    try {
      const { SUBSCRIPTION_PLANS } = await import('./types.mjs');
      const currentStripePriceId = Object.values(SUBSCRIPTION_PLANS)
        .find(p => p.name.toLowerCase() === currentSubscription.planId)?.priceId;
      await updateTenantUserGroupsByPriceId(tenant.tenantId, currentStripePriceId, null);
      console.log(`Subscription deleted for tenant ${tenant.tenantId}, downgraded users from ${currentSubscription.planId} to free plan`);
    } catch (error) {
      console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
      // Don't throw error - subscription deletion should still succeed
    }
  }

  // Publish success metric
  await publishSubscriptionMetric('deleted', { status: 'deleted', planId: currentSubscription.planId || 'unknown' }, tenant.tenantId, eventId);

  console.log(`Successfully processed subscription.deleted for tenant ${tenant.tenantId}, users downgraded to free tier`);
}

/**
 * Main Lambda handler for EventBridge events
 */
export const handler = async (event) => {
  const context = createBillingEventContext(event);

  try {
    // Process event based on type
    const eventHandlers = {
      'customer.subscription.created': () => handleSubscriptionCreated(context.eventData.subscriptionData, context.eventData.id),
      'customer.subscription.updated': () => handleSubscriptionUpdated(context.eventData.subscriptionData, context.eventData.id),
      'customer.subscription.deleted': () => handleSubscriptionDeleted(context.eventData.subscriptionData, context.eventData.id)
    };

    const handler = eventHandlers[context.eventData.type];
    if (!handler) {
      context.logger.info(`Unhandled event type: ${context.eventData.type}`);
      return;
    }

    // Execute handler with timing and metrics
    await context.timeOperation('subscription-processing', handler);

    context.logger.info(`Successfully processed ${context.eventData.type} event`);

  } catch (error) {
    await context.handleError(error, 'subscription-event-processing');
  }
};
