import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

const PAGE_SIZE = 10;

/**
 * Look up the most recently published issue for a tenant.
 * Queries GSI1 in descending order, paginating until a published issue
 * (one with publishedAt defined) is found, or no more items remain.
 *
 * @param {string} tenantId
 * @returns {Promise<{pk: string, issueNumber: number} | null>}
 */
export async function getMostRecentPublishedIssue(tenantId) {
  let lastEvaluatedKey;

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
      if (item.publishedAt !== undefined && item.publishedAt !== null) {
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
