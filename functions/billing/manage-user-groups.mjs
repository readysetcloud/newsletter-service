import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const cognitoClient = new CognitoIdentityProviderClient({});
const dynamoClient = new DynamoDBClient({});

const USER_POOL_ID = process.env.USER_POOL_ID;
const TABLE_NAME = process.env.TABLE_NAME;

// Subscription plan to Cognito group mapping
export const SUBSCRIPTION_PLANS = {
  free: {
    name: "Free",
    priceId: null,
    cognitoGroup: "free-tier",
    limits: {
      subscribers: 500,
      monthlyEmails: 2500,
      customDomain: false,
      sponsorReminders: false
    }
  },
  creator: {
    name: "Creator",
    priceId: "price_creator_monthly",
    cognitoGroup: "creator-tier",
    limits: {
      subscribers: 1000,
      monthlyEmails: 10000,
      customDomain: true,
      sponsorReminders: true
    }
  },
  pro: {
    name: "Pro",
    priceId: "price_pro_monthly",
    cognitoGroup: "pro-tier",
    limits: {
      subscribers: 10000,
      monthlyEmails: 100000,
      customDomain: true,
      sponsorReminders: true
    }
  }
};

/**
 * Maps a Stripe price ID to the corresponding Cognito group
 * @param {string} priceId - Stripe price ID
 * @returns {string|null} - Cognito group name or null if not found
 */
export function mapPriceIdToGroup(priceId) {
  const plan = Object.values(SUBSCRIPTION_PLANS).find(p => p.priceId === priceId);
  return plan ? plan.cognitoGroup : null;
}

/**
 * Maps a plan name to the corresponding Cognito group
 * @param {string} planName - Plan name (free, creator, pro)
 * @returns {string|null} - Cognito group name or null if not found
 */
export function mapPlanToGroup(planName) {
  const plan = SUBSCRIPTION_PLANS[planName];
  return plan ? plan.cognitoGroup : null;
}

/**
 * Gets all users for a specific tenant from DynamoDB
 * @param {string} tenantId - The tenant ID
 * @returns {Promise<Array>} - Array of user objects with username and other details
 */
export async function getTenantUsers(tenantId) {
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :tenantId AND begins_with(sk, :userPrefix)',
    ExpressionAttributeValues: marshall({
      ':tenantId': tenantId,
      ':userPrefix': 'user#'
    })
  };

  try {
    const result = await dynamoClient.send(new QueryCommand(params));
    const items = result.Items?.map(item => unmarshall(item)) || [];

    // Extract usernames from the sk field (format: user#username)
    return items.map(item => ({
      username: item.sk ? item.sk.replace('user#', '') : item.username,
      role: item.role || 'member',
      joinedAt: item.joinedAt,
      ...item
    })).filter(item => item.username); // Filter out items without usernames
  } catch (error) {
    console.error(`Error getting tenant users for ${tenantId}:`, error);
    throw new Error(`Failed to retrieve tenant users: ${error.message}`);
  }
}

/**
 * Adds a user to a Cognito group
 * @param {string} username - The username
 * @param {string} groupName - The Cognito group name
 * @returns {Promise<boolean>} - Success status
 */
export async function addUserToGroup(username, groupName) {
  const params = {
    GroupName: groupName,
    UserPoolId: USER_POOL_ID,
    Username: username
  };

  try {
    await cognitoClient.send(new AdminAddUserToGroupCommand(params));
    console.log(`Successfully added user ${username} to group ${groupName}`);
    return true;
  } catch (error) {
    // Handle expected errors that shouldn't stop processing
    if (error.name === 'UserNotConfirmedException') {
      console.warn(`User ${username} not confirmed yet, skipping group assignment`);
      return false;
    }
    if (error.name === 'UserNotFoundException') {
      console.warn(`User ${username} not found in Cognito, skipping group assignment`);
      return false;
    }

    console.error(`Error adding user ${username} to group ${groupName}:`, error);
    throw new Error(`Failed to add user to group: ${error.message}`);
  }
}

/**
 * Removes a user from a Cognito group
 * @param {string} username - The username
 * @param {string} groupName - The Cognito group name
 * @returns {Promise<boolean>} - Success status
 */
export async function removeUserFromGroup(username, groupName) {
  const params = {
    GroupName: groupName,
    UserPoolId: USER_POOL_ID,
    Username: username
  };

  try {
    await cognitoClient.send(new AdminRemoveUserFromGroupCommand(params));
    console.log(`Successfully removed user ${username} from group ${groupName}`);
    return true;
  } catch (error) {
    // Handle expected errors that shouldn't stop processing
    if (error.name === 'UserNotInGroupException') {
      console.warn(`User ${username} not in group ${groupName}, skipping removal`);
      return false;
    }
    if (error.name === 'UserNotFoundException') {
      console.warn(`User ${username} not found in Cognito, skipping group removal`);
      return false;
    }

    console.error(`Error removing user ${username} from group ${groupName}:`, error);
    throw new Error(`Failed to remove user from group: ${error.message}`);
  }
}

/**
 * Processes group updates for multiple users with error handling
 * @param {Array} users - Array of user objects with username
 * @param {string} targetGroup - The target Cognito group
 * @param {string} action - 'add' or 'remove'
 * @returns {Promise<Object>} - Results object with success/failure counts
 */
export async function batchProcessUserGroups(users, targetGroup, action) {
  const results = {
    successful: [],
    failed: [],
    skipped: []
  };

  console.log(`Starting batch ${action} operation for ${users.length} users to/from group ${targetGroup}`);

  for (const user of users) {
    try {
      let success = false;

      if (action === 'add') {
        success = await addUserToGroup(user.username, targetGroup);
      } else if (action === 'remove') {
        success = await removeUserFromGroup(user.username, targetGroup);
      } else {
        throw new Error(`Invalid action: ${action}`);
      }

      if (success) {
        results.successful.push(user.username);
      } else {
        results.skipped.push(user.username);
      }
    } catch (error) {
      console.error(`Failed to ${action} user ${user.username} to/from group ${targetGroup}:`, error);
      results.failed.push({
        username: user.username,
        error: error.message
      });
    }
  }

  console.log(`Batch ${action} completed:`, {
    successful: results.successful.length,
    failed: results.failed.length,
    skipped: results.skipped.length
  });

  return results;
}

/**
 * Updates user groups for a tenant based on subscription status
 * @param {string} tenantId - The tenant ID
 * @param {string} fromPlan - Previous plan (free, creator, pro) or null
 * @param {string} toPlan - New plan (free, creator, pro)
 * @returns {Promise<Object>} - Results object with operation details
 */
export async function updateTenantUserGroups(tenantId, fromPlan, toPlan) {
  console.log(`Updating user groups for tenant ${tenantId}: ${fromPlan} -> ${toPlan}`);

  // Get all users for this tenant
  const users = await getTenantUsers(tenantId);

  if (users.length === 0) {
    console.log(`No users found for tenant ${tenantId}`);
    return { users: 0, operations: [] };
  }

  const operations = [];

  // Remove from old group if specified
  if (fromPlan && fromPlan !== toPlan) {
    const fromGroup = mapPlanToGroup(fromPlan);
    if (fromGroup) {
      const removeResults = await batchProcessUserGroups(users, fromGroup, 'remove');
      operations.push({
        action: 'remove',
        group: fromGroup,
        results: removeResults
      });
    }
  }

  // Add to new group
  const toGroup = mapPlanToGroup(toPlan);
  if (toGroup) {
    const addResults = await batchProcessUserGroups(users, toGroup, 'add');
    operations.push({
      action: 'add',
      group: toGroup,
      results: addResults
    });
  }

  return {
    tenantId,
    users: users.length,
    operations
  };
}

/**
 * Updates user groups based on Stripe price ID changes
 * @param {string} tenantId - The tenant ID
 * @param {string|null} fromPriceId - Previous Stripe price ID or null
 * @param {string|null} toPriceId - New Stripe price ID or null (null = free plan)
 * @returns {Promise<Object>} - Results object with operation details
 */
export async function updateTenantUserGroupsByPriceId(tenantId, fromPriceId, toPriceId) {
  // Map price IDs to plan names
  const fromPlan = fromPriceId ?
    Object.keys(SUBSCRIPTION_PLANS).find(key => SUBSCRIPTION_PLANS[key].priceId === fromPriceId) :
    'free';

  const toPlan = toPriceId ?
    Object.keys(SUBSCRIPTION_PLANS).find(key => SUBSCRIPTION_PLANS[key].priceId === toPriceId) :
    'free';

  if (!toPlan) {
    throw new Error(`Unknown price ID: ${toPriceId}`);
  }

  return await updateTenantUserGroups(tenantId, fromPlan, toPlan);
}

/**
 * Ensures a user is in the correct group based on their tenant's subscription
 * @param {string} username - The username
 * @param {string} tenantId - The tenant ID
 * @returns {Promise<Object>} - Results object with operation details
 */
export async function ensureUserInCorrectGroup(username, tenantId) {
  // This function would be used when a new user joins a tenant
  // to ensure they get the correct group membership immediately

  // Get tenant's current subscription to determine correct group
  const subscription = await getTenantSubscription(tenantId);
  const targetPlan = subscription?.status === 'active' && subscription.planId ?
    Object.keys(SUBSCRIPTION_PLANS).find(key => SUBSCRIPTION_PLANS[key].priceId === subscription.planId) :
    'free';

  const targetGroup = mapPlanToGroup(targetPlan);

  if (!targetGroup) {
    throw new Error(`Unable to determine target group for tenant ${tenantId}`);
  }

  // Remove from all other subscription groups first
  const allGroups = Object.values(SUBSCRIPTION_PLANS).map(p => p.cognitoGroup);
  const removeResults = [];

  for (const group of allGroups) {
    if (group !== targetGroup) {
      const success = await removeUserFromGroup(username, group);
      if (success) {
        removeResults.push(group);
      }
    }
  }

  // Add to correct group
  const addSuccess = await addUserToGroup(username, targetGroup);

  return {
    username,
    tenantId,
    targetGroup,
    removedFrom: removeResults,
    addedTo: addSuccess ? targetGroup : null
  };
}

/**
 * Helper function to get tenant subscription from DynamoDB
 * @param {string} tenantId - The tenant ID
 * @returns {Promise<Object|null>} - Subscription object or null
 */
async function getTenantSubscription(tenantId) {
  const { GetItemCommand } = await import('@aws-sdk/client-dynamodb');

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
    console.error(`Error getting subscription for tenant ${tenantId}:`, error);
    return null;
  }
}
