import { SESv2Client, DeleteContactCommand } from "@aws-sdk/client-sesv2";
import { decrypt } from "../utils/helpers.mjs";

const ses = new SESv2Client();
export const handler = async (event) => {
  try {
    const { tenantId } = event.pathParameters;
    const email = event.queryStringParameters?.email;
    if (email) {
      const emailAddress = decrypt(email);
      await ses.send(new DeleteContactCommand({
        ContactListName: process.env.LIST,
        EmailAddress: emailAddress
      }));
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
