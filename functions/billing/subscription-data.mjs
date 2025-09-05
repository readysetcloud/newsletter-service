/**
 * @fileoverview DynamoDB subscription record management functions
 */

import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { validateSubscriptionRecord, createSubscriptionRecord } from './types.mjs';

const client = new DynamoDBClient();

/**
 * Stores a subscription record in DynamoDB
 */
export async function storeSubscriptionRecord(subscriptionData) {
  const record = createSubscriptionRecord(subscriptionData);
  const validation = validateSubscriptionRecord(record);

  if (!validation.isValid) {
    throw new Error(`Invalid subscription record: ${validation.errors.join(', ')}`);
  }

  try {
    const command = new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(record),
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    });

    await client.send(command);
    return record;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      throw new Error(`Subscription record already exists for tenant: ${subscriptionData.tenantId}`);
    }
    throw new Error(`Failed to store subscription record: ${error.message}`);
  }
}
/**
 * Retrieves a subscription record by tenant ID
 */
export async function getSubscriptionRecord(tenantId) {
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  try {
    const command = new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: 'subscription'
      })
    });

    const result = await client.send(command);
    return result.Item ? unmarshall(result.Item) : null;
  } catch (error) {
    throw new Error(`Failed to retrieve subscription record: ${error.message}`);
  }
}

/**
 * Updates subscription status and related fields with idempotency support
 */
export async function updateSubscriptionStatus(tenantId, updates, options = {}) {
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  if (!updates || Object.keys(updates).length === 0) {
    throw new Error('Updates object is required and cannot be empty');
  }

  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  updates.updatedAt = new Date().toISOString();

  // Add idempotency key if provided
  if (options.idempotencyKey) {
    updates.lastEventId = options.idempotencyKey;
  }

  for (const [key, value] of Object.entries(updates)) {
    updateExpressions.push(`#${key} = :${key}`);
    expressionAttributeNames[`#${key}`] = key;
    expressionAttributeValues[`:${key}`] = value;
  }

  // Build condition expression
  let conditionExpression = 'attribute_exists(pk) AND attribute_exists(sk)';

  // Add idempotency check if key provided
  if (options.idempotencyKey) {
    conditionExpression += ' AND (attribute_not_exists(lastEventId) OR lastEventId <> :idempotencyKey)';
    expressionAttributeValues[':idempotencyKey'] = options.idempotencyKey;
  }

  try {
    const command = new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: 'subscription'
      }),
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ConditionExpression: conditionExpression,
      ReturnValues: 'ALL_NEW'
    });

    const result = await client.send(command);
    return result.Attributes ? unmarshall(result.Attributes) : null;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      if (options.idempotencyKey) {
        // Check if this is due to idempotency (event already processed)
        const existing = await getSubscriptionRecord(tenantId);
        if (existing && existing.lastEventId === options.idempotencyKey) {
          console.log(`Event ${options.idempotencyKey} already processed for tenant ${tenantId}, skipping`);
          return existing;
        }
      }
      throw new Error(`Subscription record not found for tenant: ${tenantId}`);
    }
    throw new Error(`Failed to update subscription status: ${error.message}`);
  }
}

/**
 * Atomically updates subscription with event tracking
 */
export async function atomicSubscriptionUpdate(tenantId, subscriptionUpdates, eventId = null) {
  const options = eventId ? { idempotencyKey: eventId } : {};
  return await updateSubscriptionStatus(tenantId, subscriptionUpdates, options);
}
/**
 * Deletes a subscription record
 */
export async function deleteSubscriptionRecord(tenantId) {
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  try {
    const command = new DeleteItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: 'subscription'
      }),
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)'
    });

    await client.send(command);
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      throw new Error(`Subscription record not found for tenant: ${tenantId}`);
    }
    throw new Error(`Failed to delete subscription record: ${error.message}`);
  }
}

/**
 * Batch retrieves subscription records for multiple tenants
 */
export async function batchGetSubscriptionRecords(tenantIds) {
  if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
    throw new Error('Tenant IDs array is required and cannot be empty');
  }

  if (tenantIds.length > 100) {
    throw new Error('Cannot batch get more than 100 subscription records at once');
  }

  try {
    const requestItems = tenantIds.map(tenantId => marshall({
      pk: tenantId,
      sk: 'subscription'
    }));

    const command = new BatchGetItemCommand({
      RequestItems: {
        [process.env.TABLE_NAME]: {
          Keys: requestItems
        }
      }
    });

    const result = await client.send(command);
    const responses = result.Responses[process.env.TABLE_NAME] || [];
    return responses.map(item => unmarshall(item));
  } catch (error) {
    throw new Error(`Failed to batch get subscription records: ${error.message}`);
  }
}
