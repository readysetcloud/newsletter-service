import { SESv2Client, ListContactsCommand } from "@aws-sdk/client-sesv2";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getTenant, sendWithRetry } from "../utils/helpers.mjs";

const ses = new SESv2Client();
const s3 = new S3Client();

export const handler = async (event) => {
  try {
    const tenantId = event.tenant;
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return { message: 'Tenant not found' };
    }
    const emailAddresses = [];
    let nextToken;
    do {
      const contacts = await sendWithRetry(() => ses.send(new ListContactsCommand({
        ContactListName: tenant.list,
        NextToken: nextToken
      })));
      if (contacts.Contacts?.length) {
        emailAddresses.push(...contacts.Contacts.map(c => c.EmailAddress));
      }
      nextToken = contacts.NextToken;
    } while (nextToken);

    const report = {
      total: emailAddresses.length,
      addresses: emailAddresses
    };

    const key = `reports/${tenantId}-${new Date().toISOString()}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.BUCKET,
      Key: key,
      Body: JSON.stringify(report),
      ContentType: "application/json"
    }));

    return { key };
  } catch (err) {
    console.error(err);
    return false;
  }
};
