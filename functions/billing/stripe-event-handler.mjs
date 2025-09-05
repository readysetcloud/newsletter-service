/**
 * @fileoverview EventBridge event handler for Stripe events
 * Processes Stripe events delivered via AWS EventBridge integration
 */

import { DynamoDBClient, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  storeSubscriptionRecord,
  getSubscriptionRecord,
  updateSubscriptionStatus
} from './subscription-data.mjs';
import {
  updateTenantUserGroupsByPriceId,
  getTenantUsers
} from './manage-user-groups.mjs';

const dynamoClient = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Finds tenant by Stripe customer ID using GSI
 */
async function findTenantByCustomerId(customerId) {
  const { QueryCommand } = await import('@aws-sdk/client-dynamodb');
  const { unmarshall } = await import('@aws-sdk/util-dynamodb');

  const params = {
    TableName: TABLE_NAME,
    IndexName: 'StripeCustomerIndex',
    KeyConditionExpression: 'stripeCustomerId = :customerId',
    ExpressionAttributeValues: marshall({
      ':customerId': customerId
    })
  };

  try {
    const result = await dynamoClient.send(new QueryCommand(params));
    const items = result.Items?.map(item => unmarshall(item)) || [];
    return items[0] || null;
  } catch (error) {
    console.error('Error finding tenant by customer ID:', error);
    throw new Error(`Failed to find tenant for customer ${customerId}: ${error.message}`);
  }
}

/**
 * Performs atomic subscription update with group management
 * Uses DynamoDB transactions to ensure data consistency
 */
async function atomicSubscriptionUpdate(tenantId, subscriptionUpdates, groupUpdateData = null) {
  const transactItems = [];

  // Add subscription record update to transaction
  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  // Always add updatedAt timestamp
  subscriptionUpdates.updatedAt = new Date().toISOString();

  Object.entries(subscriptionUpdates).forEach(([key, value], index) => {
    const attrName = `#attr${index}`;
    const attrValue = `:val${index}`;
    updateExpressions.push(`${attrName} = ${attrValue}`);
    expressionAttributeNames[attrName] = key;
    expressionAttributeValues[attrValue] = value;
  });

  transactItems.push({
    Update: {
      TableName: TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: 'subscription'
      }),
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)'
    }
  });

  // Add group update tracking record if provided
  if (groupUpdateData) {
    const groupUpdateRecord = {
      pk: tenantId,
      sk: `group-update#${Date.now()}`,
      eventType: groupUpdateData.eventType,
      fromPlan: groupUpdateData.fromPlan,
      toPlan: groupUpdateData.toPlan,
      userCount: groupUpdateData.userCount,
      processedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
    };

    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: marshall(groupUpdateRecord),
        ConditionExpression: 'attribute_not_exists(pk)'
      }
    });
  }

  try {
    const command = new TransactWriteItemsCommand({
      TransactItems: transactItems
    });

    await dynamoClient.send(command);
    console.log(`Atomic subscription update completed for tenant ${tenantId}`);
    return true;
  } catch (error) {
    console.error(`Atomic subscription update failed for tenant ${tenantId}:`, error);
    throw new Error(`Transaction failed: ${error.message}`);
  }
}

/**
 * Handles subscription created events with atomic updates
 */
async function handleSubscriptionCreated(subscription) {
  console.log('Processing subscription.created event:', subscription.id);

  const customerId = subscription.customer;
  const subscriptionId = subscription.id;
  const status = subscription.status;
  const currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
  const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
  const cancelAtPeriodEnd = subscription.cancel_at_period_end;

  // Get plan ID from subscription items
  const planId = subscription.items.data[0]?.price?.id;
  if (!planId) {
    throw new Error('No plan ID found in subscription');
  }

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Get tenant users for group update tracking
  const users = await getTenantUsers(tenant.tenantId);

  // Prepare subscription data
  const subscriptionData = {
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerId,
    status,
    planId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    createdAt: new Date().toISOString()
  };

  // Prepare group update tracking data
  const groupUpdateData = {
    eventType: 'subscription.created',
    fromPlan: 'free',
    toPlan: planId,
    userCount: users.length
  };

  // Perform atomic update
  await atomicSubscriptionUpdate(tenant.tenantId, subscriptionData, groupUpdateData);

  // Update Cognito groups if subscription is active
  if (status === 'active') {
    try {
      const groupResult = await updateTenantUserGroupsByPriceId(tenant.tenantId, null, planId);
      console.log(`Successfully updated user groups for tenant ${tenant.tenantId}:`, groupResult);
    } catch (error) {
      console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
      // EventBridge will retry the entire event if this fails
      throw new Error(`Group update failed: ${error.message}`);
    }
  }

  console.log(`Subscription created successfully for tenant ${tenant.tenantId}`);
}

/**
 * Handles subscription updated events with atomic updates
 */
async function handleSubscriptionUpdated(subscription) {
  console.log('Processing subscription.updated event:', subscription.id);

  const customerId = subscription.customer;
  const subscriptionId = subscription.id;
  const status = subscription.status;
  const currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
  const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
  const cancelAtPeriodEnd = subscription.cancel_at_period_end;
  const canceledAt = subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null;

  const planId = subscription.items.data[0]?.price?.id;

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Get current subscription to compare changes
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);
  if (!currentSubscription) {
    throw new Error(`No existing subscription record found for tenant: ${tenant.tenantId}`);
  }

  // Get tenant users for group update tracking
  const users = await getTenantUsers(tenant.tenantId);

  // Prepare subscription update data
  const subscriptionUpdates = {
    stripeSubscriptionId: subscriptionId,
    status,
    planId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd
  };

  // Handle cancellation-specific data
  if (cancelAtPeriodEnd && !currentSubscription.cancelAtPeriodEnd) {
    subscriptionUpdates.canceledAt = canceledAt;
    subscriptionUpdates.accessEndsAt = currentPeriodEnd;
    console.log(`Subscription cancelled for tenant ${tenant.tenantId}, access will end at ${currentPeriodEnd}`);
  } else if (!cancelAtPeriodEnd && currentSubscription.cancelAtPeriodEnd) {
    subscriptionUpdates.canceledAt = null;
    subscriptionUpdates.accessEndsAt = null;
    console.log(`Subscription cancellation reversed for tenant ${tenant.tenantId}`);
  }

  // Determine group update requirements
  let groupUpdateData = null;
  let shouldUpdateGroups = false;
  let fromPriceId = null;
  let toPriceId = null;

  if (status === 'active' && currentSubscription.status !== 'active') {
    // Subscription became active
    shouldUpdateGroups = true;
    toPriceId = planId;
    groupUpdateData = {
      eventType: 'subscription.activated',
      fromPlan: 'free',
      toPlan: planId,
      userCount: users.length
    };
  } else if (status !== 'active' && currentSubscription.status === 'active') {
    // Subscription became inactive
    if (!cancelAtPeriodEnd || status === 'canceled') {
      shouldUpdateGroups = true;
      fromPriceId = currentSubscription.planId;
      groupUpdateData = {
        eventType: 'subscription.deactivated',
        fromPlan: currentSubscription.planId,
        toPlan: 'free',
        userCount: users.length
      };
    }
  } else if (status === 'active' && planId !== currentSubscription.planId) {
    // Plan changed
    shouldUpdateGroups = true;
    fromPriceId = currentSubscription.planId;
    toPriceId = planId;
    groupUpdateData = {
      eventType: 'subscription.plan_changed',
      fromPlan: currentSubscription.planId,
      toPlan: planId,
      userCount: users.length
    };
  }

  // Perform atomic update
  await atomicSubscriptionUpdate(tenant.tenantId, subscriptionUpdates, groupUpdateData);

  // Update Cognito groups if needed
  if (shouldUpdateGroups) {
    try {
      const groupResult = await updateTenantUserGroupsByPriceId(tenant.tenantId, fromPriceId, toPriceId);
      console.log(`Successfully updated user groups for tenant ${tenant.tenantId}:`, groupResult);
    } catch (error) {
      console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
      // EventBridge will retry the entire event if this fails
      throw new Error(`Group update failed: ${error.message}`);
    }
  }

  console.log(`Subscription updated successfully for tenant ${tenant.tenantId}`);
}

/**
 * Handles subscription deleted events with atomic updates
 */
async function handleSubscriptionDeleted(subscription) {
  console.log('Processing subscription.deleted event:', subscription.id);

  const customerId = subscription.customer;
  const deletedAt = new Date().toISOString();

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Get current subscription to get plan info
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);
  if (!currentSubscription) {
    console.log(`No subscription record found for tenant ${tenant.tenantId}, skipping deletion`);
    return;
  }

  // Get tenant users for group update tracking
  const users = await getTenantUsers(tenant.tenantId);

  // Prepare subscription update data
  const subscriptionUpdates = {
    status: 'deleted',
    deletedAt
  };

  // Prepare group update tracking data
  const groupUpdateData = {
    eventType: 'subscription.deleted',
    fromPlan: currentSubscription.planId,
    toPlan: 'free',
    userCount: users.length
  };

  // Perform atomic update
  await atomicSubscriptionUpdate(tenant.tenantId, subscriptionUpdates, groupUpdateData);

  // Remove users from premium groups (downgrade to free)
  if (currentSubscription.planId) {
    try {
      const groupResult = await updateTenantUserGroupsByPriceId(tenant.tenantId, currentSubscription.planId, null);
      console.log(`Subscription deleted for tenant ${tenant.tenantId}, downgraded users:`, groupResult);
      console.log(`Billing period ended for cancelled subscription - tenant ${tenant.tenantId} users automatically downgraded to free tier`);
    } catch (error) {
      console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
      // EventBridge will retry the entire event if this fails
      throw new Error(`Group update failed: ${error.message}`);
    }
  }

  console.log(`Subscription deleted successfully for tenant ${tenant.tenantId}`);
}

/**
 * Handles successful payment events with atomic updates
 */
async function handlePaymentSucceeded(invoice) {
  console.log('Processing invoice.payment_succeeded event:', invoice.id);

  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) {
    console.log('Invoice not associated with subscription, skipping');
    return;
  }

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Get current subscription
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);
  if (!currentSubscription) {
    console.log(`No subscription record found for tenant ${tenant.tenantId}, skipping payment processing`);
    return;
  }

  // Only process if subscription was past_due
  if (currentSubscription.status === 'past_due') {
    // Get tenant users for group update tracking
    const users = await getTenantUsers(tenant.tenantId);

    // Prepare subscription update data
    const subscriptionUpdates = {
      status: 'active'
    };

    // Prepare group update tracking data
    const groupUpdateData = {
      eventType: 'payment.succeeded',
      fromPlan: 'free',
      toPlan: currentSubscription.planId,
      userCount: users.length
    };

    // Perform atomic update
    await atomicSubscriptionUpdate(tenant.tenantId, subscriptionUpdates, groupUpdateData);

    // Re-add users to premium groups
    if (currentSubscription.planId) {
      try {
        const groupResult = await updateTenantUserGroupsByPriceId(tenant.tenantId, null, currentSubscription.planId);
        console.log(`Payment succeeded for tenant ${tenant.tenantId}, restored to plan:`, groupResult);
      } catch (error) {
        console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
        // EventBridge will retry the entire event if this fails
        throw new Error(`Group update failed: ${error.message}`);
      }
    }
  }

  console.log(`Payment succeeded processed for tenant ${tenant.tenantId}`);
}

/**
 * Handles failed payment events with atomic updates
 */
async function handlePaymentFailed(invoice) {
  console.log('Processing invoice.payment_failed event:', invoice.id);

  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) {
    console.log('Invoice not associated with subscription, skipping');
    return;
  }

  // Find tenant by Stripe customer ID
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) {
    throw new Error(`No tenant found for customer ID: ${customerId}`);
  }

  // Get current subscription
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);
  if (!currentSubscription) {
    console.log(`No subscription record found for tenant ${tenant.tenantId}, skipping payment failure processing`);
    return;
  }

  // Get tenant users for group update tracking
  const users = await getTenantUsers(tenant.tenantId);

  // Prepare subscription update data
  const subscriptionUpdates = {
    status: 'past_due'
  };

  // Prepare group update tracking data
  const groupUpdateData = {
    eventType: 'payment.failed',
    fromPlan: currentSubscription.planId,
    toPlan: currentSubscription.planId, // Keep same plan, just mark as past_due
    userCount: users.length
  };

  // Perform atomic update
  await atomicSubscriptionUpdate(tenant.tenantId, subscriptionUpdates, groupUpdateData);

  console.log(`Payment failed processed for tenant ${tenant.tenantId} - subscription marked as past_due`);
  // Note: We don't immediately remove users from groups on payment failure
}

/**
 * Main EventBridge event handler
 * Processes Stripe events delivered via AWS EventBridge
 */
export const handler = async (event) => {
  console.log('Received EventBridge event:', JSON.stringify(event, null, 2));

  try {
    // EventBridge event structure validation
    if (!event.detail || !event.detail.type) {
      throw new Error('Invalid EventBridge event structure - missing detail.type');
    }

    // Extract Stripe event from EventBridge event
    const stripeEvent = event.detail;
    const eventType = stripeEvent.type;

    console.log(`Processing Stripe event type: ${eventType}`);

    // Event handlers mapping
    const eventHandlers = {
      'customer.subscription.created': () => handleSubscriptionCreated(stripeEvent.data.object),
      'customer.subscription.updated': () => handleSubscriptionUpdated(stripeEvent.data.object),
      'customer.subscription.deleted': () => handleSubscriptionDeleted(stripeEvent.data.object),
      'invoice.payment_succeeded': () => handlePaymentSucceeded(stripeEvent.data.object),
      'invoice.payment_failed': () => handlePaymentFailed(stripeEvent.data.object)
    };

    const handler = eventHandlers[eventType];
    if (handler) {
      await handler();
      console.log(`Successfully processed ${eventType} event`);
    } else {
      console.log(`Unhandled event type: ${eventType}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        processed: true,
        eventType,
        eventId: stripeEvent.id
      })
    };

  } catch (error) {
    console.error('EventBridge event processing error:', error);

    // Log error details for debugging
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      event: JSON.stringify(event, null, 2)
    });

    // Throw error to trigger EventBridge retry mechanism
    throw error;
  }
};
