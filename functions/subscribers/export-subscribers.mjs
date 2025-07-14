import { SESv2Client, ListContactsCommand } from "@aws-sdk/client-sesv2";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const ses = new SESv2Client();
const s3 = new S3Client();

export const handler = async (event) => {
  try {
    const emailAddresses = [];
    let nextToken;
    do {
      const contacts = await ses.send(new ListContactsCommand({
        ContactListName: event.list,
        NextToken: nextToken
      }));
      if (contacts.Contacts?.length) {
        emailAddresses.push(...contacts.Contacts.map(c => c.EmailAddress));
      }
      nextToken = contacts.NextToken;
    } while (nextToken);

    const report = {
      total: emailAddresses.length,
      addresses: emailAddresses
    };

    const key = `reports/${event.list}-${new Date().toISOString()}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.BUCKET,
      Key,
      Body: JSON.stringify(report),
      ContentType: "application/json"
    }));

    return { key };
  } catch (err) {
    console.error(err);
    return false;
  }
};
