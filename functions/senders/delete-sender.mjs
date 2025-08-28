import { DynamoDBClient, GetItemCommand, DeleteItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, DeleteEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse, formatEmptyResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';
import { KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();
const ses = new SESv2Client();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    // Get senderId from path parameters
    const senderId = event.pathParameters?.senderId;
    if (!senderId) {
      return formatResponse(400, 'Sender ID is required');
    }

    // Check if sender exists and belongs to tenant
    const existingSender = await getSenderById(tenantId, senderId);
    if (!existingSender) {
      return formatResponse(404, 'Sender not found');
    }

    // Clean up SES identity
    try {
      await cleanupSESIdentity(existingSender);
    } catch (sesError) {
      console.error('SES cleanup failed (continuing with deletion):', sesError);
      // Continue with deletion even if SES cleanup fails
    }

    // If this was the default sender, we need to set another one as default
    if (existingSender.isDefault) {
      await reassignDefaultSender(tenantId, senderId);
    }

    // Delete the sender from DynamoDB
    await ddb.send(new DeleteItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      }),
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)'
    }));

    return formatEmptyResponse();

  } catch (error) {
    console.error('Delete sender error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.name === 'ConditionalCheckFailedException') {
      return formatResponse(404, 'Sender not found');
    }

    return formatResponse(500, 'Failed to delete sender email');
  }
};

/**
 * Get sender by ID and validate tenant ownership
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @returns {Promise<Object|null>} Sender record or null if not found
 */
const getSenderById = async (tenantId, senderId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      })
    }));

    return result.Item ? unmarshall(result.Item) : null;
  } catch (error) {
    console.error('Error getting sender by ID:', error);
    throw new Error('Failed to retrieve sender');
  }
};

/**
 * Clean up SES identity (email or domain) with proper tenant cleanup sequence
 * @param {Object} sender - Sender record
 */
const cleanupSESIdentity = async (sender) => {
  try {
    const identity = sender.verificationType === 'domain' ? sender.domain : sender.email;

    if (!identity) {
      return;
    }

    // Note: SES tenant association is not available in the current AWS SDK
    // Identity isolation is handled at the application level through tenantId

    // Delete the SES identity
    await ses.send(new DeleteEmailIdentityCommand({
      EmailIdentity: identity
    }));
    console.log(`Cleaned up SES identity: ${identity}`);

  } catch (error) {
    // Log but don't throw - we want to continue with DynamoDB deletion
    console.error('Failed to cleanup SES identity:', {
      identity: sender.verificationType === 'domain' ? sender.domain : sender.email,
      error: error.message
    });
  }
};

/**
 * Reassign default sender to another sender if the deleted one was default
 * @param {string} tenantId - Tenant identifier
 * @param {string} deletedSenderId - ID of sender being deleted
 */
const reassignDefaultSender = async (tenantId, deletedSenderId) => {
  try {
    // Query all other senders for this tenant
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': KEY_PATTERNS.SENDER_GSI1PK(tenantId)
      })
    }));

    if (!result.Items) return;

    // Find the first sender that's not being deleted and is verified
    const remainingSenders = result.Items
      .map(item => unmarshall(item))
      .filter(sender => sender.senderId !== deletedSenderId);

    if (remainingSenders.length === 0) {
      // No remaining senders, nothing to do
      return;
    }

    // Prefer verified senders, but fall back to any sender
    const newDefaultSender = remainingSenders.find(sender => sender.verificationStatus === 'verified')
      || remainingSenders[0];

    // Set the new default sender
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(newDefaultSender.senderId)
      }),
      UpdateExpression: 'SET isDefault = :isDefault, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':isDefault': true,
        ':updatedAt': new Date().toISOString()
      })
    }));

    console.log(`Reassigned default sender to: ${newDefaultSender.email}`);
  } catch (error) {
    console.error('Error reassigning default sender:', error);
    // Don't throw here as this is a secondary operation
  }
};
