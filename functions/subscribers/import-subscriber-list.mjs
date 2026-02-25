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
    await throttle(tasks);

    await updateSubscriberCount(tenantId);
    console.log(`Added ${list.items.length} contacts`);

    return true;
  } catch (err) {
    console.error('Error in Lambda:', err.message);
    console.error(err.stack);
    return false;
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

  try {
    await sendWithRetry(() => ddb.send(new BatchWriteItemCommand({
      RequestItems: {
        [process.env.SUBSCRIBERS_TABLE_NAME]: [
          {
            PutRequest: {
              Item: marshall(subscriberItem)
            }
          }
        ]
      }
    })), 'BatchWriteItem');
  } catch (err) {
    // Handle duplicates gracefully - DynamoDB will skip them without error in BatchWrite
    // Log warning but don't throw
    console.warn(`Error adding subscriber ${contact.address}:`, err.message);
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
