import { DynamoDBClient, UpdateItemCommand, BatchWriteItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { getTenant, formatResponse, throttle, sendWithRetry } from "../utils/helpers.mjs";

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const { tenantId, list } = event;
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return formatResponse(404, 'Tenant not found');
    }

    const tasks = list.items.map(item => () => addSubscriber(tenantId, item));
    console.log(`Processing ${tasks.length} contacts with throttling enabled`);

    // Track failures during import
    const results = await Promise.allSettled(tasks.map(task => task()));
    const failures = results.filter(r => r.status === 'rejected');

    if (failures.length > 0) {
      console.error(`Import completed with ${failures.length} failures out of ${tasks.length} total`);
      failures.forEach((failure, idx) => {
        console.error(`Failed item ${idx}:`, failure.reason?.message || failure.reason);
      });

      // Update count with successful imports only
      await updateSubscriberCount(tenantId);

      // Return partial success with failure details
      return {
        success: false,
        imported: tasks.length - failures.length,
        failed: failures.length,
        total: tasks.length,
        errors: failures.map(f => f.reason?.message || String(f.reason))
      };
    }

    await updateSubscriberCount(tenantId);
    console.log(`Successfully added ${list.items.length} contacts`);

    return {
      success: true,
      imported: list.items.length,
      failed: 0,
      total: list.items.length
    };
  } catch (err) {
    console.error('Error in Lambda:', err.message);
    console.error(err.stack);
    return {
      success: false,
      error: err.message
    };
  }
};

const addSubscriber = async (tenantId, contact) => {
  const addedAt = new Date().toISOString();

  const subscriberItem = {
    tenantId,
    email: contact.address.toLowerCase(), // Normalize email to lowercase
    addedAt,
    ...(contact.firstName && { firstName: contact.firstName }),
    ...(contact.lastName && { lastName: contact.lastName })
  };

  const requestItems = {
    [process.env.SUBSCRIBERS_TABLE_NAME]: [
      {
        PutRequest: {
          Item: marshall(subscriberItem)
        }
      }
    ]
  };

  try {
    const response = await sendWithRetry(() => ddb.send(new BatchWriteItemCommand({
      RequestItems: requestItems
    })), 'BatchWriteItem');

    // Check for unprocessed items and retry them
    if (response.UnprocessedItems && Object.keys(response.UnprocessedItems).length > 0) {
      console.warn(`Unprocessed items detected for ${contact.address}, retrying...`);

      // Retry unprocessed items with exponential backoff
      let unprocessedItems = response.UnprocessedItems;
      let retryAttempts = 0;
      const maxRetries = 3;

      while (unprocessedItems && Object.keys(unprocessedItems).length > 0 && retryAttempts < maxRetries) {
        retryAttempts++;
        const backoffMs = Math.min(1000 * Math.pow(2, retryAttempts), 5000);
        await new Promise(resolve => setTimeout(resolve, backoffMs));

        const retryResponse = await ddb.send(new BatchWriteItemCommand({
          RequestItems: unprocessedItems
        }));

        unprocessedItems = retryResponse.UnprocessedItems;
      }

      // If still unprocessed after retries, throw error
      if (unprocessedItems && Object.keys(unprocessedItems).length > 0) {
        throw new Error(`Failed to write subscriber ${contact.address} after ${maxRetries} retries due to throttling`);
      }
    }
  } catch (err) {
    // Only suppress known duplicate/no-op cases
    if (err.name === 'ConditionalCheckFailedException') {
      console.info(`Subscriber ${contact.address} already exists, skipping`);
      return;
    }

    // All other errors (IAM, validation, throttling) should fail the import
    console.error(`Failed to add subscriber ${contact.address}:`, err.message);
    throw err;
  }
};

const getSubscriberCount = async (tenantId) => {
  let total = 0;
  let lastEvaluatedKey;

  do {
    const response = await sendWithRetry(() => ddb.send(new QueryCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId
      }),
      Select: 'COUNT',
      ExclusiveStartKey: lastEvaluatedKey
    })), 'QuerySubscriberCount');

    total += response.Count || 0;
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return total;
};

const updateSubscriberCount = async (tenantId) => {
  const count = await getSubscriberCount(tenantId);
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'tenant'
    }),
    UpdateExpression: 'SET #subscribers = :val',
    ExpressionAttributeNames: {
      '#subscribers': 'subscribers'
    },
    ExpressionAttributeValues: {
      ':val': { N: `${count}` }
    }
  }));
};
