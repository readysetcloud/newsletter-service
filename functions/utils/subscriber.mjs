import { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

/**
 * List all subscribers for a tenant
 * @param {string} tenantId - Tenant identifier
 * @param {object} options - Optional pagination options
 * @param {object} options.exclusiveStartKey - LastEvaluatedKey from previous query for pagination
 * @returns {Promise<{subscribers: Array, lastEvaluatedKey: object|undefined}>} Subscribers and pagination key
 */
export const listSubscribers = async (tenantId, options = {}) => {
  try {
    const queryParams = {
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId
      })
    };

    // Add pagination support
    if (options.exclusiveStartKey) {
      queryParams.ExclusiveStartKey = options.exclusiveStartKey;
    }

    const response = await ddb.send(new QueryCommand(queryParams));

    // Unmarshall items and extract subscriber data
    const subscribers = (response.Items || []).map(item => {
      const subscriber = unmarshall(item);
      return {
        email: subscriber.email,
        firstName: subscriber.firstName || null,
        lastName: subscriber.lastName || null,
        addedAt: subscriber.addedAt
      };
    });

    return {
      subscribers,
      lastEvaluatedKey: response.LastEvaluatedKey
    };
  } catch (error) {
    console.error('List subscribers failed:', {
      tenantId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Unsubscribe user from tenant's mailing list
 * @param {string} tenantId - Tenant identifier
 * @param {string} emailAddress - Email address to unsubscribe
 * @param {string} method - Unsubscribe method ('encrypted-link', 'manual-form', 'complaint')
 * @param {object} metadata - Optional metadata (ipAddress, userAgent, etc.)
 * @returns {boolean} True if successful or already unsubscribed, false if unknown error
 */
export const unsubscribeUser = async (tenantId, emailAddress, method = 'encrypted-link', metadata = {}) => {
  try {
    const email = emailAddress.toLowerCase();

    // Delete subscriber from Subscribers table only if it exists
    // Using ReturnValues to check if an item was actually deleted
    const deleteResult = await ddb.send(new DeleteItemCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      Key: marshall({
        tenantId: tenantId,
        email: email
      }),
      ReturnValues: 'ALL_OLD'
    }));

    // Only decrement count if a subscriber was actually removed
    if (deleteResult.Attributes) {
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: tenantId,
          sk: 'tenant'
        }),
        UpdateExpression: 'SET subscribers = if_not_exists(subscribers, :zero) - :dec',
        ExpressionAttributeValues: marshall({
          ':dec': 1,
          ':zero': 0
        }),
        // Prevent count from going below zero
        ConditionExpression: 'if_not_exists(subscribers, :zero) >= :dec'
      }));

      console.log('Unsubscribe successful:', { tenantId, emailAddress });
    } else {
      console.log('Unsubscribe skipped - subscriber not found:', { tenantId, emailAddress });
    }

    return true;

  } catch (error) {
    // If the condition fails (count would go negative), log but still return success
    if (error.name === 'ConditionalCheckFailedException') {
      console.warn('Subscriber count already at minimum:', { tenantId });
      return true;
    }

    console.error('Unsubscribe failed:', {
      tenantId,
      email: '[REDACTED]',
      error: error.message
    });
    return false;
  }
};
