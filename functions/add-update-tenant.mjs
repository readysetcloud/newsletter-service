import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, CreateContactListCommand } from "@aws-sdk/client-sesv2";
import { marshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient();
const ses = new SESv2Client();

export const handler = async (event) => {
  try {
    const { detail: data } = event;
    const { tenantId, ...tenant } = data;

    const list = await createContactList(tenantId);
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: tenantId,
        sk: 'tenant',
        ...tenant,
        list,
        subscribers: 0
      })
    }));
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Something went wrong' })
    };
  }
};

const createContactList = async (tenantId) => {
  await ses.send(new CreateContactListCommand({
    ContactListName: tenantId,
    Description: `Contact list for ${tenantId} newsletter`
  }));

  return tenantId;
}
