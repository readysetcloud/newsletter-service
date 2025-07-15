import { SESv2Client, CreateContactCommand } from "@aws-sdk/client-sesv2";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const ses = new SESv2Client();
const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const { tenantId, list } = event;
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return formatResponse(404, 'Tenant not found');
    }
    await Promise.all(list.items.map(async (item) => await addContact(tenant.list, item)));
    await updateSubscriberCount(tenantId, list.items.length);
    console.log(`Added ${list.length} contacts`);
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
};

const addContact = async (list, contact) => {
  const contactData = {
    ContactListName: list,
    EmailAddress: contact.address
  };

  if (contact.firstName || contact.lastName) {
    contactData.AttributesData = JSON.stringify({
      ...contact.firstName && { firstName: contact.firstName },
      ...contact.lastName && { lastName: contact.lastName }
    });
  }

  await ses.send(new CreateContactCommand(contactData));
};

const updateSubscriberCount = async (tenantId, countAdded) => {
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
      ':val': { N: `${countAdded}` }
    }
  }));
};
