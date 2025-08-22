import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';
import { TIER_LIMITS, KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    // Get user tier from authorizer context (assuming it's added to context)
    const tier = event.requestContext?.authorizer?.tier || 'free-tier';

    // Query all sender emails for this tenant
    const senders = await getSendersByTenant(tenantId);

    // Get tier limits and current usage
    const tierConfig = TIER_LIMITS[tier] || TIER_LIMITS['free-tier'];
    const tierLimits = {
      tier,
      maxSenders: tierConfig.maxSenders,
      currentCount: senders.length,
      canUseDNS: tierConfig.canUseDNS,
      canUseMailbox: tierConfig.canUseMailbox
    };

    return formatResponse(200, {
      senders: senders.map(formatSenderResponse),
      tierLimits
    });

  } catch (error) {
    console.error('Get senders error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to retrieve sender emails');
  }
};

/**
 * Query all sender emails for a tenant
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<Array>} Array of sender records
 */
const getSendersByTenant = async (tenantId) => {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': KEY_PATTERNS.SENDER_GSI1PK(tenantId)
      })
    }));

    return result.Items ? result.Items.map(item => unmarshall(item)) : [];
  } catch (error) {
    console.error('Error querying senders:', error);
    throw new Error('Failed to query sender emails');
  }
};

/**
 * Format sender record for API response
 * @param {Object} sender - Raw sender record from DynamoDB
 * @returns {Object} Formatted sender response
 */
const formatSenderResponse = (sender) => {
  return {
    senderId: sender.senderId,
    email: sender.email,
    name: sender.name || null,
    verificationType: sender.verificationType,
    verificationStatus: sender.verificationStatus,
    isDefault: sender.isDefault || false,
    domain: sender.domain || null,
    createdAt: sender.createdAt,
    updatedAt: sender.updatedAt,
    verifiedAt: sender.verifiedAt || null,
    failureReason: sender.failureReason || null
  };
};
