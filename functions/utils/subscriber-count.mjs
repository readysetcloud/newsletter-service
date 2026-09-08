import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { isSubscriberRecord } from './subscriber-record.mjs';

let ddb;
function getClient() {
  if (!ddb) ddb = new DynamoDBClient();
  return ddb;
}

/**
 * Count the actual subscriber rows in a tenant's partition.
 *
 * The segments feature shares this partition, overloading the `email` sort key
 * with `SEGMENT…` bookkeeping rows, and DynamoDB will not accept a key
 * attribute in a `FilterExpression`. So a bare `Select: 'COUNT'` over the
 * partition counts segment rows as people — which is exactly how the tenant
 * counter drifted 552 high on readysetcloud: a recount that ran after every
 * bounce cleanup baked that day's segment members into `tenant.subscribers`.
 * The rows come back projecting only `email` and `isSubscriberRecord` decides,
 * the same predicate every send path uses.
 *
 * This query must be strongly consistent. The tenant counter is read strongly
 * before this scan, and an eventually consistent row read could temporarily
 * miss a signup that the counter already contains, making reconciliation lower
 * an otherwise-correct counter. Any write after that counter read still changes
 * the counter and is protected by the conditional correction below.
 *
 * @param {string} tenantId
 * @returns {Promise<number>}
 */
export const countSubscriberRows = async (tenantId) => {
  let count = 0;
  let lastKey;

  do {
    const result = await getClient().send(new QueryCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: marshall({ ':tenantId': tenantId }),
      ProjectionExpression: 'email',
      ConsistentRead: true,
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));

    for (const item of result.Items || []) {
      if (isSubscriberRecord(unmarshall(item))) {
        count++;
      }
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return count;
};

/**
 * Bring `tenant.subscribers` back in line with the rows when the two disagree.
 *
 * Every writer of the counter moves it inside the same transaction as the row
 * it belongs to, so in steady state this finds nothing to do. It exists for the
 * cases those transactions cannot cover: the residue of an older bug (see
 * `countSubscriberRows`), a row removed by hand in the console, a restored
 * backup. Without it a wrong counter is permanent — the send path reports the
 * stale number as "recipients" on every issue, and nothing ever notices.
 *
 * The write is conditional on the counter still holding the value that was
 * compared against. That is what makes this safe where the old "recount and
 * SET the total" was not: a signup or unsubscribe committing between the count
 * and this write changes the counter, the condition fails, and the correction
 * is skipped rather than erasing their increment. The next run gets another
 * look.
 *
 * Never throws — this is bookkeeping behind a cleanup that already succeeded.
 *
 * @param {string} tenantId
 * @param {{ stored: number|null, actual: number }} counts
 * @returns {Promise<'in-sync'|'corrected'|'skipped'>}
 */
export const reconcileSubscriberCount = async (tenantId, { stored, actual }) => {
  if (typeof stored !== 'number' || typeof actual !== 'number') {
    return 'skipped';
  }
  if (stored === actual) {
    return 'in-sync';
  }

  console.warn(`[SUBSCRIBER COUNT] Drift detected for ${tenantId}: counter ${stored}, rows ${actual} (off by ${stored - actual})`);

  try {
    await getClient().send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: tenantId, sk: 'tenant' }),
      UpdateExpression: 'SET #subscribers = :actual',
      ConditionExpression: '#subscribers = :stored',
      ExpressionAttributeNames: { '#subscribers': 'subscribers' },
      ExpressionAttributeValues: marshall({ ':actual': actual, ':stored': stored })
    }));
    console.warn(`[SUBSCRIBER COUNT] Corrected ${tenantId} counter from ${stored} to ${actual}`);
    return 'corrected';
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // A live signup or unsubscribe moved the counter while we were counting.
      // Their write is the one that must survive; leave it for the next run.
      console.warn(`[SUBSCRIBER COUNT] Counter for ${tenantId} changed during reconciliation; leaving it for the next run`);
      return 'skipped';
    }
    console.error(`[SUBSCRIBER COUNT] Failed to correct counter for ${tenantId}:`, error);
    return 'skipped';
  }
};
