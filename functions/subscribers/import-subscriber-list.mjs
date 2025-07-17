import { SESv2Client, CreateContactCommand, ListContactsCommand } from "@aws-sdk/client-sesv2";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { getTenant, formatResponse, throttle, sendWithRetry } from "../utils/helpers.mjs";

const ses = new SESv2Client();
const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const { tenantId, list } = event;
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return formatResponse(404, 'Tenant not found');
    }

    const tasks = list.items.map(item => () => addContact(tenant.list, item));
    console.log(`Processing ${tasks.length} contacts with throttling enabled`);
    await throttle(tasks);

    await updateSubscriberCount(tenantId, tenant.list);
    console.log(`Added ${list.items.length} contacts`);

    return true;
  } catch (err) {
    console.error('Error in Lambda:', err.message);
    console.error(err.stack);
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
  try {
    await sendWithRetry(() => ses.send(new CreateContactCommand(contactData)));
  } catch (err) {
    if (err.name === 'AlreadyExistsException') {
      console.warn(`Contact already exists: ${contact.address}`);
    } else {
      throw err;
    }
  }
};

const getSubscriberCount = async (listName) => {
  let total = 0;
  let nextToken;

  do {
    const response = await sendWithRetry(() => ses.send(new ListContactsCommand({
      ContactListName: listName,
      NextToken: nextToken
    })));
    total += response.Contacts?.length || 0;
    nextToken = response.NextToken;
  } while (nextToken);

  return total;
};

const updateSubscriberCount = async (tenantId, listName) => {
  const count = await getSubscriberCount(listName);
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
