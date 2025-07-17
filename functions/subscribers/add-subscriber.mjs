import { SESv2Client, CreateContactCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, getTenant } from '../utils/helpers.mjs';

const ses = new SESv2Client();
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

    await addContact(tenant.list, contact);
    await updateSubscriberCount(tenantId);

    return formatResponse(201, 'Contact added');
  }
  catch (err) {
    console.error('Add subscriber error:', err);
    return formatResponse(500, 'Something went wrong');
  }
};

const addContact = async (list, contact) => {
  const contactData = {
    ContactListName: list,
    EmailAddress: contact.email
  };

  if (contact.firstName || contact.lastName) {
    contactData.AttributesData = JSON.stringify({
      ...contact.firstName && { firstName: contact.firstName },
      ...contact.lastName && { lastName: contact.lastName }
    });
  }

  await ses.send(new CreateContactCommand(contactData));
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
