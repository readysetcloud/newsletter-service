import { DynamoDBClient, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, getTenant } from '../utils/helpers.mjs';
import { publishSubscriberEvent, EVENT_TYPES } from '../utils/event-publisher.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const { tenant: tenantId } = event.pathParameters;
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return formatResponse(404, 'Tenant not found');
    }

    if (!event.body) {
      return formatResponse(400, 'Missing request body');
    }

    const contact = JSON.parse(event.body);

    if (!contact.email) {
      return formatResponse(400, 'Email is required');
    }

    const shouldUpdateCount = await addSubscriber(tenantId, contact);
    if (shouldUpdateCount) {
      const addedAt = new Date().toISOString();
      const timestamp = Date.now();

      await updateSubscriberCount(tenantId);

      // Create subscriber event record for stats tracking
      await createSubscriberEventRecord(tenantId, contact.email, addedAt, timestamp);

      // Publish subscriber added event after successful addition
      await publishSubscriberEvent(
        tenantId,
        null, // No specific user ID for public subscriber additions
        EVENT_TYPES.SUBSCRIBER_ADDED,
        {
          email: contact.email,
          firstName: contact.firstName || null,
          lastName: contact.lastName || null,
          subscriberCount: tenant.subscribers + 1, // New count after addition
          addedAt
        }
      );
    }

    return formatResponse(201, 'Contact added');
  }
  catch (err) {
    console.error('Add subscriber error:', err);
    return formatResponse(500, 'Something went wrong');
  }
};

const addSubscriber = async (tenantId, contact) => {
  const addedAt = new Date().toISOString();

  const subscriberItem = {
    tenantId,
    email: contact.email.toLowerCase(), // Normalize email to lowercase
    addedAt,
    ...(contact.firstName && { firstName: contact.firstName }),
    ...(contact.lastName && { lastName: contact.lastName })
  };

  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      Item: marshall(subscriberItem),
      ConditionExpression: 'attribute_not_exists(tenantId)'
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn(`Subscriber already exists: ${contact.email}`);
      return false;
    } else {
      throw err;
    }
  }
};

const updateSubscriberCount = async (tenantId) => {
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'tenant'
    }),
    UpdateExpression: 'SET #subscribers = #subscribers + :val',
    ExpressionAttributeNames: {
      '#subscribers': 'subscribers'
    },
    ExpressionAttributeValues: {
      ':val': { N: '1' }
    }
  }));
};

const createSubscriberEventRecord = async (tenantId, email, addedAt, timestamp) => {
  const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days from now

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall({
      pk: tenantId,
      sk: `subscriber#${timestamp}#${email}`,
      GSI1PK: tenantId,
      GSI1SK: `subscriber#${timestamp}`,
      email,
      addedAt,
      ttl
    })
  }));
};
