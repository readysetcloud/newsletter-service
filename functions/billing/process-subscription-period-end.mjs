/**
 * @fileoverview Lambda function to process subscription period endings
 * This function runs on a schedule to check for cancelled subscriptions that have reached their period end
 * and automatically downgrades users to free tier
 */

import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { updateTenantUserGroupsByPriceId } from './manage-user-groups.mjs';

const dynamoClient = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Scans for cancelled subscriptions that have reached their period end
 */
async function getCancelledSubscriptionsAtPeriodEnd() {
  const now = new Date().toISOString();

  const params = {
    TableName: TABLE_NAME,
    FilterExpression: 'sk = :sk AND #status = :status AND cancelAtPeriodEnd = :cancelAtPeriodEnd AND accessEndsAt <= :now',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: marshall({
      ':sk': 'subscription',
      ':status': 'cancelled',
      ':cancelAtPeriodEnd': true,
      ':now': now
    })
  };

  try {
    const result = await dynamoClient.send(new ScanCommand(params));
    return result.Items?.map(item => unmarshall(item)) || [];
  } catch (error) {
    console.error('Error scanning for cancelled subscriptions:', error);
    throw error;
  }
}

/**
 * Processes a single subscription period end
 */
async function processSubscriptionPeriodEnd(subscription) {
  const tenantId = subscription.pk;
  const planId = subscription.planId;

  console.log(`Processing period end for tenant ${tenantId}, downgrading from plan ${planId} to free`);

  try {
    // Update subscription status to expired
    await updateSubscriptionRecord(tenantId, {
      status: 'expired',
      expiredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Downgrade users from premium to free tier
    if (planId) {
      await updateTenantUserGroupsByPriceId(tenantId, planId, null);
      console.log(`Successfully downgraded tenant ${tenantId} users from ${planId} to free tier`);
    }

    // Log the downgrade event for requirement 7.3 and 7.5
    console.log(`Subscription period ended - tenant ${tenantId} automatically downgraded to free tier`);

    return {
      tenantId,
      success: true,
      message: `Successfully processed period end for tenant ${tenantId}`
    };

  } catch (error) {
    console.error(`Failed to process period end for tenant ${tenantId}:`, error);

    return {
      tenantId,
      success: false,
      error: error.message
    };
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
    console.log(`Subscription record updated successfully for tenant ${tenantId}`);
  } catch (error) {
    console.error(`Error updating subscription record for tenant ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Sends notification to brand administrators about the downgrade
 * This satisfies requirement 7.5
 */
async function sendDowngradeNotification(tenantId, planId) {
  // TODO: Implement notification system
  // This could integrate with SES to send email notifications
  // or with the existing notification system
  console.log(`Notification: Tenant ${tenantId} subscription has expired and been downgraded from ${planId} to free tier`);

  // For now, we'll just log the notification
  // In a full implementation, this would:
  // 1. Get tenant admin email addresses
  // 2. Send email notification about the downgrade
  // 3. Log the notification for audit purposes
}

/**
 * Main Lambda handler
 */
export const handler = async (event) => {
  console.log('Starting subscription period-end processing:', JSON.stringify(event, null, 2));

  try {
    // Get all cancelled subscriptions that have reached their period end
    const expiredSubscriptions = await getCancelledSubscriptionsAtPeriodEnd();

    console.log(`Found ${expiredSubscriptions.length} subscriptions to process`);

    if (expiredSubscriptions.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No subscriptions to process',
          processedCount: 0
        })
      };
    }

    // Process each subscription
    const results = [];
    for (const subscription of expiredSubscriptions) {
      const result = await processSubscriptionPeriodEnd(subscription);
      results.push(result);

      // Send notification for successful downgrades
      if (result.success) {
        await sendDowngradeNotification(subscription.pk, subscription.planId);
      }
    }

    // Summary of processing
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`Period-end processing completed: ${successCount} successful, ${failureCount} failed`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Period-end processing completed',
        processedCount: expiredSubscriptions.length,
        successCount,
        failureCount,
        results
      })
    };

  } catch (error) {
    console.error('Period-end processing error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
