import crypto from 'crypto';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { updateTenantUserGroupsByPriceId } from './manage-user-groups.mjs';

const dynamoClient = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;

// Cache for webhook secret
let webhookSecret;
async function getWebhookSecret() {
  if (!webhookSecret) {
    webhookSecret = await getParameter(process.env.STRIPE_WEBHOOK_SECRET_PARAM, { decrypt: true });
  }
  return webhookSecret;
}

/**
 * Verifies Stripe webhook signature
 */
function verifyWebhookSignature(payload, signature, secret) {
  const elements = signature.split(',');
  const signatureElements = {};

  for (const element of elements) {
    const [key, value] = element.split('=');
    signatureElements[key] = value;
  }

  if (!signatureElements.t || !signatureElements.v1) {
    throw new Error('Invalid signature format');
  }

  const timestamp = signatureElements.t;
  const expectedSignature = signatureElements.v1;

  // Check timestamp to prevent replay attacks (5 minutes tolerance)
  const timestampTolerance = 300; // 5 minutes in seconds
  const currentTime = Math.floor(Date.now() / 1000);

  if (Math.abs(currentTime - parseInt(timestamp)) > timestampTolerance) {
    throw new Error('Request timestamp too old');
  }

  // Create expected signature
  const signedPayload = timestamp + '.' + payload;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  if (computedSignature !== expectedSignature) {
    throw new Error('Invalid signature');
  }

  return true;
}

/**
 * Handles subscription created events
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

  // Update subscription record in DynamoDB
  await updateSubscriptionRecord(tenant.tenantId, {
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerId,
    status,
    planId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Update Cognito groups if subscription is active
  if (status === 'active') {
    try {
      await updateTenantUserGroupsByPriceId(tenant.tenantId, null, planId);
      console.log(`Successfully updated user groups for tenant ${tenant.tenantId} to plan ${planId}`);
    } catch (error) {
      console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
      // Don't throw error - webhook should still succeed even if group update fails
    }
  }
}

/**
 * Handles subscription updated events
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

  // Get current subscription to compare status changes
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);

  // Prepare subscription update data
  const subscriptionUpdateData = {
    stripeSubscriptionId: subscriptionId,
    status,
    planId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    updatedAt: new Date().toISOString()
  };

  // Handle cancellation-specific data
  if (cancelAtPeriodEnd && !currentSubscription?.cancelAtPeriodEnd) {
    // Subscription was just cancelled - add cancellation timestamp and end date
    subscriptionUpdateData.canceledAt = canceledAt;
    subscriptionUpdateData.accessEndsAt = currentPeriodEnd; // Access ends at current period end
    console.log(`Subscription cancelled for tenant ${tenant.tenantId}, access will end at ${currentPeriodEnd}`);
  } else if (!cancelAtPeriodEnd && currentSubscription?.cancelAtPeriodEnd) {
    // Cancellation was reversed - remove cancellation data
    subscriptionUpdateData.canceledAt = null;
    subscriptionUpdateData.accessEndsAt = null;
    console.log(`Subscription cancellation reversed for tenant ${tenant.tenantId}`);
  }

  // Update subscription record
  await updateSubscriptionRecord(tenant.tenantId, subscriptionUpdateData);

  // Handle group changes based on status and cancellation
  try {
    if (status === 'active' && currentSubscription?.status !== 'active') {
      // Subscription became active - add to premium groups
      await updateTenantUserGroupsByPriceId(tenant.tenantId, null, planId);
      console.log(`Activated subscription for tenant ${tenant.tenantId}, updated to plan ${planId}`);
    } else if (status !== 'active' && currentSubscription?.status === 'active') {
      // Subscription became inactive - remove from premium groups (downgrade to free)
      // But only if it's not just a cancellation (cancelled subscriptions maintain access until period end)
      if (!cancelAtPeriodEnd || status === 'canceled') {
        await updateTenantUserGroupsByPriceId(tenant.tenantId, currentSubscription.planId, null);
        console.log(`Deactivated subscription for tenant ${tenant.tenantId}, downgraded to free plan`);
      }
    } else if (status === 'active' && planId !== currentSubscription?.planId) {
      // Plan changed - update groups
      await updateTenantUserGroupsByPriceId(tenant.tenantId, currentSubscription.planId, planId);
      console.log(`Changed subscription plan for tenant ${tenant.tenantId}: ${currentSubscription.planId} -> ${planId}`);
    }

    // Special handling for cancelled subscriptions that are still active
    if (cancelAtPeriodEnd && status === 'active' && !currentSubscription?.cancelAtPeriodEnd) {
      console.log(`Subscription cancelled but still active for tenant ${tenant.tenantId}, maintaining premium access until ${currentPeriodEnd}`);
      // No group changes needed - users keep premium access until period end
    }
  } catch (error) {
    console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
    // Don't throw error - webhook should still succeed even if group update fails
  }
}

/**
 * Handles subscription deleted events
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

  // Update subscription record to deleted status with deletion timestamp
  await updateSubscriptionRecord(tenant.tenantId, {
    status: 'deleted',
    deletedAt,
    updatedAt: deletedAt
  });

  // Remove users from premium groups (downgrade to free)
  // This happens when a cancelled subscription period has ended
  if (currentSubscription?.planId) {
    try {
      await updateTenantUserGroupsByPriceId(tenant.tenantId, currentSubscription.planId, null);
      console.log(`Subscription deleted for tenant ${tenant.tenantId}, downgraded users from ${currentSubscription.planId} to free plan`);

      // Log the downgrade event for requirement 7.3 (automatic downgrade when billing period ends)
      console.log(`Billing period ended for cancelled subscription - tenant ${tenant.tenantId} users automatically downgraded to free tier`);
    } catch (error) {
      console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
      // Don't throw error - webhook should still succeed even if group update fails
    }
  }
}

/**
 * Handles successful payment events
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

  // Update subscription status to active if it was past_due
  const currentSubscription = await getSubscriptionRecord(tenant.tenantId);
  if (currentSubscription?.status === 'past_due') {
    await updateSubscriptionRecord(tenant.tenantId, {
      status: 'active',
      updatedAt: new Date().toISOString()
    });

    // Re-add users to premium groups
    if (currentSubscription.planId) {
      try {
        await updateTenantUserGroupsByPriceId(tenant.tenantId, null, currentSubscription.planId);
        console.log(`Payment succeeded for tenant ${tenant.tenantId}, restored to plan ${currentSubscription.planId}`);
      } catch (error) {
        console.error(`Failed to update user groups for tenant ${tenant.tenantId}:`, error);
        // Don't throw error - webhook should still succeed even if group update fails
      }
    }
  }
}

/**
 * Handles failed payment events
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

  // Update subscription status to past_due
  await updateSubscriptionRecord(tenant.tenantId, {
    status: 'past_due',
    updatedAt: new Date().toISOString()
  });

  // Note: We don't immediately remove users from groups on payment failure
  // This gives them time to update payment method
}

/**
 * Finds tenant by Stripe customer ID
 */
async function findTenantByCustomerId(customerId) {
  // Query DynamoDB to find tenant with this Stripe customer ID
  // This assumes the tenant record has stripeCustomerId field
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'StripeCustomerIndex', // GSI on stripeCustomerId
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
    throw error;
  }
}

/**
 * Gets subscription record for a tenant
 */
async function getSubscriptionRecord(tenantId) {
  const params = {
    TableName: TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'subscription'
    })
  };

  try {
    const result = await dynamoClient.send(new GetItemCommand(params));
    return result.Item ? unmarshall(result.Item) : null;
  } catch (error) {
    console.error('Error getting subscription record:', error);
    throw error;
  }
}

/**
 * Updates subscription record in DynamoDB
 */
async function updateSubscriptionRecord(tenantId, subscriptionData) {
  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  Object.entries(subscriptionData).forEach(([key, value], index) => {
    const attrName = `#attr${index}`;
    const attrValue = `:val${index}`;

    updateExpressions.push(`${attrName} = ${attrValue}`);
    expressionAttributeNames[attrName] = key;
    expressionAttributeValues[attrValue] = value;
  });

  const params = {
    TableName: TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'subscription'
    }),
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: marshall(expressionAttributeValues)
  };

  try {
    await dynamoClient.send(new UpdateItemCommand(params));
    console.log('Subscription record updated successfully');
  } catch (error) {
    console.error('Error updating subscription record:', error);
    throw error;
  }
}



/**
 * Main Lambda handler
 */
export const handler = async (event) => {
  console.log('Received webhook event:', JSON.stringify(event, null, 2));

  try {
    // Verify webhook signature
    const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!signature) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing Stripe signature' })
      };
    }

    // Get webhook secret from SSM Parameter Store
    const secret = await getWebhookSecret();
    verifyWebhookSignature(event.body, signature, secret);

    // Parse webhook payload
    const webhookEvent = JSON.parse(event.body);

    // Process event based on type
    const eventHandlers = {
      'customer.subscription.created': () => handleSubscriptionCreated(webhookEvent.data.object),
      'customer.subscription.updated': () => handleSubscriptionUpdated(webhookEvent.data.object),
      'customer.subscription.deleted': () => handleSubscriptionDeleted(webhookEvent.data.object),
      'invoice.payment_succeeded': () => handlePaymentSucceeded(webhookEvent.data.object),
      'invoice.payment_failed': () => handlePaymentFailed(webhookEvent.data.object)
    };

    const handler = eventHandlers[webhookEvent.type];
    if (handler) {
      await handler();
      console.log(`Successfully processed ${webhookEvent.type} event`);
    } else {
      console.log(`Unhandled event type: ${webhookEvent.type}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true })
    };

  } catch (error) {
    console.error('Webhook processing error:', error);

    // Return appropriate error status
    if (error.message.includes('Invalid signature') || error.message.includes('timestamp too old')) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
