import { SESv2Client, DeleteContactCommand } from "@aws-sdk/client-sesv2";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { getTenant, decrypt } from "../utils/helpers.mjs";

const ses = new SESv2Client();
const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const tenantId = event.pathParameters.tenant;
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      console.warn(`Could not find tenant ${tenantId} to unsubscribe from`);
    } else {
      const email = event.queryStringParameters?.email;
      if (email) {
        const emailAddress = decrypt(email);
        await ses.send(new DeleteContactCommand({
          ContactListName: tenant.list,
          EmailAddress: emailAddress
        }));
        await updateSubscriberCount(tenantId);
      }
    }
  } catch (err) {
    console.error(err);
  }
  finally {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html'
      },
      body: `<html>
    <h1>Sorry to see you go :(</h1>
    <p>We have deleted your contact from our mailing list.</p>
    <p>If you change your mind, you can always sign up again.</p>
    </html>`
    };
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
      ':val': { N: '-1' }
    }
  }));
};
