import { DynamoDBClient, GetItemCommand, UpdateItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';
import { KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();

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

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { name, isDefault } = body;

    // Validate input
    const validationError = validateUpdateSenderRequest(body);
    if (validationError) {
      return formatResponse(400, validationError);
    }

    // Check if sender exists and belongs to tenant
    const existingSender = await getSenderById(tenantId, senderId);
    if (!existingSender) {
      return formatResponse(404, 'Sender not found');
    }

    // If setting as default, we need to unset other defaults first
    if (isDefault === true) {
      await unsetOtherDefaults(tenantId, senderId);
    }

    // Build update expression
    const updateExpression = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (name !== undefined) {
      updateExpression.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = name;
    }

    if (isDefault !== undefined) {
      updateExpression.push('isDefault = :isDefault');
      expressionAttributeValues[':isDefault'] = isDefault;
    }

    // Always update the updatedAt timestamp
    updateExpression.push('updatedAt = :updatedAt');
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    if (updateExpression.length === 1) { // Only updatedAt
      return formatResponse(400, 'No valid fields to update');
    }

    // Update the sender
    const updateResult = await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      }),
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
      ReturnValues: 'ALL_NEW'
    }));

    const updatedSender = unmarshall(updateResult.Attributes);

    return formatResponse(200, {
      senderId: updatedSender.senderId,
      email: updatedSender.email,
      name: updatedSender.name || null,
      verificationType: updatedSender.verificationType,
      verificationStatus: updatedSender.verificationStatus,
      isDefault: updatedSender.isDefault || false,
      domain: updatedSender.domain || null,
      createdAt: updatedSender.createdAt,
      updatedAt: updatedSender.updatedAt,
      verifiedAt: updatedSender.verifiedAt || null,
      failureReason: updatedSender.failureReason || null
    });

  } catch (error) {
    console.error('Update sender error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.name === 'ConditionalCheckFailedException') {
      return formatResponse(404, 'Sender not found');
    }

    return formatResponse(500, 'Failed to update sender email');
  }
};

/**
 * Validate update sender request
 * @param {Object} body - Request body
 * @returns {string|null} Error message or null if valid
 */
const validateUpdateSenderRequest = (body) => {
  const { name, isDefault } = body;

  // At least one field must be provided
  if (name === undefined && isDefault === undefined) {
    return 'At least one field must be provided for update';
  }

  // Validate name if provided
  if (name !== undefined && name !== null && typeof name !== 'string') {
    return 'Name must be a string';
  }

  // Validate isDefault if provided
  if (isDefault !== undefined && typeof isDefault !== 'boolean') {
    return 'isDefault must be a boolean';
  }

  return null;
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
 * Unset default flag for all other senders in the tenant
 * @param {string} tenantId - Tenant identifier
 * @param {string} excludeSenderId - Sender ID to exclude from update
 */
const unsetOtherDefaults = async (tenantId, excludeSenderId) => {
  try {
    // Query all senders for this tenant
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': KEY_PATTERNS.SENDER_GSI1PK(tenantId)
      })
    }));

    if (!result.Items) return;

    // Update each sender (except the one being set as default) to unset isDefault
    const updatePromises = result.Items
      .map(item => unmarshall(item))
      .filter(sender => sender.senderId !== excludeSenderId && sender.isDefault)
      .map(sender =>
        ddb.send(new UpdateItemCommand({
          TableName: process.env.TABLE_NAME,
          Key: marshall({
            pk: tenantId,
            sk: KEY_PATTERNS.SENDER(sender.senderId)
          }),
          UpdateExpression: 'SET isDefault = :isDefault, updatedAt = :updatedAt',
          ExpressionAttributeValues: marshall({
            ':isDefault': false,
            ':updatedAt': new Date().toISOString()
          })
        }))
      );

    await Promise.all(updatePromises);
  } catch (error) {
    console.error('Error unsetting other defaults:', error);
    // Don't throw here as this is a secondary operation
  }
};
