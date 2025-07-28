import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const { detail } = event;
    const referenceNumber = detail.mail.tags.referenceNumber;
    if (!referenceNumber?.length) {
      return;
    }

    const issueId = referenceNumber[0].replace(/_/g, '#');
    let stat;
    let failedEmail;
    switch (detail.eventType.toLowerCase()) {
      case 'bounce':
        stat = 'bounces';
        failedEmail = detail.mail.destination[0];
        break;
      case 'reject':
        stat = 'rejects';
        failedEmail = detail.mail.destination[0];
        break;
      case 'send':
        stat = 'sends';
        break;
      case 'delivery':
        stat = 'deliveries';
        break;
      case 'complaint':
        stat = 'complaints';
        break;
      default:
        console.warn(`Unsupported stat ${detail.eventType} was provided`);
        return;
    }

    if (stat) {
      let updateExpression = `ADD #stat :val${failedEmail ? ' SET #failedAddresses = list_append(#failedAddresses, :failedAddresses)' : ''}`;
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: issueId,
          sk: 'stats'
        }),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          '#stat': stat,
          ...(failedEmail ? { '#failedAddresses': 'failedAddresses' } : {})
        },
        ExpressionAttributeValues: marshall({
          ':val': 1,
          ...(failedEmail ? { ':failedAddresses': [failedEmail] } : {})
        })
      }));
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
};
