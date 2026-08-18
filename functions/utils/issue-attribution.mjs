import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

const PAGE_SIZE = 10;

/**
 * True when an issue has actually reached inboxes, which is what "most recently
 * published" has to mean for attribution.
 *
 * `publishedAt` is stamped when the publish workflow starts, but the workflow
 * starts `IssueSendLeadTimeMinutes` (26 hours by default) *before* the send so
 * the local-send fan-out can schedule eastward timezones for their own morning
 * — and it stamps the future send instant, not the current time. So for that
 * whole window the newest issue is one nobody has received. Attributing to it
 * credited unsubscribes and removals to an issue that had not gone out, and
 * took them from the issue the reader actually had in front of them.
 *
 * @param {string|undefined} publishedAt - ISO instant from the stats record
 * @param {number} now - epoch ms to compare against
 */
const hasBeenSent = (publishedAt, now) => {
  if (publishedAt === undefined || publishedAt === null) {
    return false;
  }

  const sentAt = Date.parse(publishedAt);
  // An unparseable stamp is old data, not a scheduled send — the lead-time
  // window is the only thing being excluded here, so keep it attributable.
  return Number.isNaN(sentAt) || sentAt <= now;
};

/**
 * Look up the most recently sent issue for a tenant.
 * Queries GSI1 in descending order, paginating until an issue that has actually
 * gone out is found, or no more items remain.
 *
 * @param {string} tenantId
 * @returns {Promise<{pk: string, issueNumber: number} | null>}
 */
export async function getMostRecentPublishedIssue(tenantId) {
  let lastEvaluatedKey;
  const now = Date.now();

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': `${tenantId}#issue`
      }),
      ScanIndexForward: false,
      Limit: PAGE_SIZE,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    }));

    const items = (result.Items || []).map(item => unmarshall(item));

    for (const item of items) {
      if (hasBeenSent(item.publishedAt, now)) {
        const issueNumber = typeof item.issueNumber === 'number'
          ? item.issueNumber
          : parseInt(item.pk?.split('#')[1], 10);

        return { pk: item.pk, issueNumber };
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return null;
}

/**
 * Atomically increment a counter on an issue stats record.
 * Uses DynamoDB ADD — no read-modify-write.
 *
 * @param {string} issuePk - e.g. "tenantId#42"
 * @param {string} counterName - "unsubscribes" | "manualRemovals" | "cleaned"
 * @returns {Promise<void>}
 */
export async function incrementIssueCounter(issuePk, counterName) {
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: issuePk,
      sk: 'stats'
    }),
    UpdateExpression: 'ADD #counter :val',
    ExpressionAttributeNames: {
      '#counter': counterName
    },
    ExpressionAttributeValues: marshall({
      ':val': 1
    })
  }));
}
