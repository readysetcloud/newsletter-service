import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { momentoClient } from '../utils/momento-client.mjs';

const eventBridge = new EventBridgeClient({});

/**
 * Triggers JWT claims refresh for users after group membership changes
 * This function publishes events that can be consumed by real-time notification systems
 * to inform users that they should refresh their authentication tokens
 *
 * @param {string} tenantId - The tenant ID whose users need token refresh
 * @param {Array<string>} usernames - Array of usernames that need token refresh
 * @param {string} reason - Reason for the refresh (e.g., 'subscription_upgrade', 'subscription_downgrade')
 * @returns {Promise<Object>} - Results of the refresh trigger operation
 */
export async function triggerJwtClaimsRefresh(tenantId, usernames, reason) {
  console.log(`Triggering JWT claims refresh for ${usernames.length} users in tenant ${tenantId}, reason: ${reason}`);

  const results = {
    tenantId,
    usernames,
    reason,
    notifications: {
      eventBridge: null,
      momento: null
    },
    timestamp: new Date().toISOString()
  };

  // 1. Publish EventBridge event for system-level processing
  try {
    const eventBridgeResult = await publishEventBridgeRefreshEvent(tenantId, usernames, reason);
    results.notifications.eventBridge = {
      success: true,
      eventId: eventBridgeResult.eventId,
      failedEntryCount: eventBridgeResult.FailedEntryCount || 0
    };
    console.log(`Successfully published EventBridge refresh event for tenant ${tenantId}`);
  } catch (error) {
    console.error(`Failed to publish EventBridge refresh event for tenant ${tenantId}:`, error);
    results.notifications.eventBridge = {
      success: false,
      error: error.message
    };
  }

  // 2. Send real-time notifications via Momento (if available)
  try {
    await publishRefreshNotification(tenantId);
    console.log(`Successfully sent Momento refresh notifications for tenant ${tenantId}`);
  } catch (error) {
    console.error(`Failed to send Momento refresh notifications for tenant ${tenantId}:`, error);
    results.notifications.momento = {
      success: false,
      error: error.message
    };
  }

  return results;
}

/**
 * Publishes an EventBridge event to notify systems about JWT refresh requirement
 * @param {string} tenantId - The tenant ID
 * @param {Array<string>} usernames - Array of usernames
 * @param {string} reason - Reason for refresh
 * @returns {Promise<Object>} - EventBridge response
 */
async function publishEventBridgeRefreshEvent(tenantId, usernames, reason) {
  const eventDetail = {
    tenantId,
    usernames,
    reason,
    timestamp: new Date().toISOString(),
    source: 'billing.group-management'
  };

  const params = {
    Entries: [{
      Source: 'newsletter-service.billing',
      DetailType: 'JWT Claims Refresh Required',
      Detail: JSON.stringify(eventDetail),
      Resources: [`tenant:${tenantId}`]
    }]
  };

  const result = await eventBridge.send(new PutEventsCommand(params));

  if (result.FailedEntryCount > 0) {
    console.warn(`EventBridge publish had ${result.FailedEntryCount} failed entries`, {
      tenantId,
      failedEntries: result.Entries?.filter(entry => entry.ErrorCode)
    });
  }

  return {
    eventId: result.Entries?.[0]?.EventId,
    FailedEntryCount: result.FailedEntryCount
  };
}

/**
 * Sends real-time notifications via Momento to inform users about token refresh
 * @param {string} tenantId - The tenant ID
 * @returns {Promise<Object>} - Momento notification results
 */
async function publishRefreshNotification(tenantId) {
  if (!momentoClient.isAvailable()) {
    console.warn('Momento not available - skipping real-time refresh notifications');
    return {
      notificationsSent: 0,
      errors: ['Momento not configured']
    };
  }

  const results = {
    notificationsSent: 0,
    errors: []
  };

  const refreshMessage = {
    type: 'jwt_refresh_required',
    timestamp: new Date().toISOString(),
    action: 'refresh_token'
  };

  // Send notification to tenant-wide channel (for admin users)
  try {
    const token = await momentoClient.generateReadOnlyToken(tenantId);
    await momentoClient.publishNotification(token, tenantId, refreshMessage);
    results.notificationsSent++;
  } catch (error) {
    console.error(`Failed to send tenant-wide refresh notification:`, error);
    results.errors.push(`Tenant notification: ${error.message}`);
  }

  return results;
}

/**
 * Triggers JWT refresh for all users in a tenant after subscription changes
 * This is a convenience function that integrates with the group management utilities
 *
 * @param {string} tenantId - The tenant ID
 * @param {string} fromPlan - Previous plan (free, creator, pro) or null
 * @param {string} toPlan - New plan (free, creator, pro)
 * @param {Array<Object>} users - Array of user objects with username property
 * @returns {Promise<Object>} - Refresh trigger results
 */
export async function triggerJwtRefreshForSubscriptionChange(tenantId, fromPlan, toPlan, users) {
  const usernames = users.map(user => user.username);

  let reason;
  if (!fromPlan || fromPlan === 'free') {
    reason = `subscription_upgrade_to_${toPlan}`;
  } else if (!toPlan || toPlan === 'free') {
    reason = `subscription_downgrade_from_${fromPlan}`;
  } else {
    reason = `subscription_change_${fromPlan}_to_${toPlan}`;
  }

  return await triggerJwtClaimsRefresh(tenantId, usernames, reason);
}

/**
 * Triggers JWT refresh for a single user when they join a tenant
 * @param {string} username - The username
 * @param {string} tenantId - The tenant ID they're joining
 * @param {string} currentPlan - Current subscription plan of the tenant
 * @returns {Promise<Object>} - Refresh trigger results
 */
export async function triggerJwtRefreshForNewUser(username, tenantId, currentPlan) {
  return await triggerJwtClaimsRefresh(
    tenantId,
    [username],
    `user_joined_tenant_${currentPlan}_plan`
  );
}

/**
 * Creates a Lambda function that can be invoked to refresh JWT claims
 * This can be used as a standalone Lambda or integrated into other functions
 *
 * @param {Object} event - Lambda event containing tenantId, usernames, and reason
 * @returns {Promise<Object>} - Lambda response
 */
export const jwtRefreshHandler = async (event) => {
  console.log('JWT Refresh Handler invoked:', JSON.stringify(event, null, 2));

  try {
    const { tenantId, usernames, reason } = event;

    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      throw new Error('usernames array is required and must not be empty');
    }

    if (!reason) {
      throw new Error('reason is required');
    }

    const result = await triggerJwtClaimsRefresh(tenantId, usernames, reason);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        result
      })
    };

  } catch (error) {
    console.error('JWT Refresh Handler error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
