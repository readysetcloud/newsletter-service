import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SESv2Client, GetSuppressedDestinationCommand } from '@aws-sdk/client-sesv2';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { screenSubscriber, checkMailDomain } from '../utils/subscriber-screening.mjs';
import { decideSubscriber } from '../utils/screening-decider.mjs';

const ddb = new DynamoDBClient();
const ses = new SESv2Client();

export const handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const inserted = unmarshall(record.dynamodb.NewImage);
      if (inserted.screening?.action !== 'pending') continue;
      const key = marshall({ tenantId: inserted.tenantId, email: inserted.email });
      const response = await ddb.send(new GetItemCommand({ TableName: process.env.SUBSCRIBERS_TABLE_NAME, Key: key, ConsistentRead: true }));
      if (!response.Item) continue;
      const subscriber = unmarshall(response.Item);
      if (subscriber.addedAt !== inserted.addedAt || subscriber.screening?.action !== 'pending') continue;
      let suppressionReason;
      try {
        const suppressed = await ses.send(new GetSuppressedDestinationCommand({ EmailAddress: subscriber.email }));
        suppressionReason = suppressed.SuppressedDestination?.Reason;
      } catch (error) {
        if (error.name !== 'NotFoundException') throw error;
      }
      const screening = await screenSubscriber(subscriber, {
        suppressionReason,
        domainStatus: await checkMailDomain(subscriber.email.split('@')[1]),
        decide: decideSubscriber
      });
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.SUBSCRIBERS_TABLE_NAME, Key: key,
        UpdateExpression: 'SET screening = :screening',
        ConditionExpression: 'addedAt = :addedAt AND screening.#action = :pending',
        ExpressionAttributeNames: { '#action': 'action' },
        ExpressionAttributeValues: marshall({ ':screening': screening, ':addedAt': inserted.addedAt, ':pending': 'pending' })
      }));
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') continue;
      console.error('Subscriber screening failed', { eventId: record.eventID, error: error.name });
      batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
    }
  }
  return { batchItemFailures };
};
