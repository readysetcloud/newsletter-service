import { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();


/**
 * Get a subscriber by email for a tenant.
 * @param {string} tenantId - Tenant identifier
 * @param {string} emailAddress - Subscriber email address
 * @returns {Promise<object|null>} Subscriber object or null when not found
 */
export const getSubscriberByEmail = async (tenantId, emailAddress) => {
  const email = emailAddress.toLowerCase();

  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.SUBSCRIBERS_TABLE_NAME,
    Key: marshall({
      tenantId,
      email
    })
  }));

  if (!result.Item) {
    return null;
  }

  return unmarshall(result.Item);
};

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

    // Unmarshall items and extract subscriber data. The segments feature stores
    // its records (SEGMENT#, SEGMENT_NAME#, SEGMENT_JOB#, and member rows)
    // under the same tenant partition with the sort key overloading `email`;
    // those must never be treated as sendable subscribers.
    const subscribers = (response.Items || [])
      .map(item => unmarshall(item))
      .filter(subscriber => subscriber.email && !subscriber.email.startsWith('SEGMENT'))
      .map(subscriber => ({
        email: subscriber.email,
        firstName: subscriber.firstName || null,
        lastName: subscriber.lastName || null,
        addedAt: subscriber.addedAt,
        lastSentAt: subscriber.lastSentAt || null,
        lastIssueSent: subscriber.lastIssueSent || null,
        timeZone: subscriber.timeZone || null,
        // Open-hour histogram (activity-timeline.mjs) — drives peak-hour local sends.
        openHours: subscriber.openHours ?? null,
        openHourTotal: subscriber.openHourTotal ?? null
      }));

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
 * @returns {Promise<{success: boolean, actuallyRemoved: boolean}>} success=true if no error, actuallyRemoved=true only when a subscriber record was deleted
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

    const actuallyRemoved = !!deleteResult.Attributes;

    // Only decrement count if a subscriber was actually removed
    if (actuallyRemoved) {
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

    return { success: true, actuallyRemoved };

  } catch (error) {
    // If the condition fails (count would go negative), log but still return success
    // The subscriber was deleted but count couldn't be decremented
    if (error.name === 'ConditionalCheckFailedException') {
      console.warn('Subscriber count already at minimum:', { tenantId });
      return { success: true, actuallyRemoved: true };
    }

    console.error('Unsubscribe failed:', {
      tenantId,
      email: '[REDACTED]',
      error: error.message
    });
    return { success: false, actuallyRemoved: false };
  }
};

/**
 * Update subscriber delivery metadata after an email is sent.
 * @param {string} tenantId - Tenant identifier
 * @param {string} emailAddress - Subscriber email address
 * @param {string|undefined} issueIdentifier - Issue identifier/reference that was sent
 * @returns {Promise<void>}
 */
export const updateSubscriberSendMetadata = async (tenantId, emailAddress, issueIdentifier) => {
  try {
    const email = emailAddress.toLowerCase();
    const expressionAttributeNames = {};
    const expressionAttributeValues = {
      ':lastSentAt': new Date().toISOString()
    };

    let updateExpression = 'SET #lastSentAt = :lastSentAt';
    expressionAttributeNames['#lastSentAt'] = 'lastSentAt';

    if (issueIdentifier) {
      updateExpression += ', #lastIssueSent = :lastIssueSent';
      expressionAttributeNames['#lastIssueSent'] = 'lastIssueSent';
      expressionAttributeValues[':lastIssueSent'] = issueIdentifier;
    }

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      Key: marshall({
        tenantId,
        email
      }),
      UpdateExpression: updateExpression,
      ConditionExpression: 'attribute_exists(tenantId) AND attribute_exists(email)',
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(expressionAttributeValues)
    }));
  } catch (error) {
    console.error('Update subscriber send metadata failed:', {
      tenantId,
      email: '[REDACTED]',
      issueIdentifier,
      error: error.message
    });
    throw error;
  }
};

