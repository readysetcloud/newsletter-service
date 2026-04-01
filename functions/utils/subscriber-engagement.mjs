import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

let ddb;
function getClient() {
  if (!ddb) ddb = new DynamoDBClient();
  return ddb;
}

/**
 * Updates subscriber engagement fields using a conditional DynamoDB update.
 * - Sets lastEngagedIssue to issueNumber if issueNumber > current value
 * - Increments engagementCount by 1 only when lastEngagedIssue changes
 * - Initializes both fields if they don't exist
 *
 * ConditionalCheckFailedException is expected for same-issue dedup and is caught silently.
 * All other DynamoDB errors are logged with context but do not propagate to the caller.
 *
 * @param {string} tenantId - Tenant partition key
 * @param {string} email - Subscriber email (sort key)
 * @param {number} issueNumber - Current issue number
 */
export async function updateSubscriberEngagement(tenantId, email, issueNumber) {
  try {
    await getClient().send(new UpdateItemCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      Key: marshall({ tenantId, email }),
      ConditionExpression: 'attribute_not_exists(lastEngagedIssue) OR lastEngagedIssue < :issueNumber',
      UpdateExpression: 'SET lastEngagedIssue = :issueNumber ADD engagementCount :one',
      ExpressionAttributeValues: marshall({
        ':issueNumber': issueNumber,
        ':one': 1
      })
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Same-issue dedup or out-of-order event — expected, not an error
      return;
    }

    console.error('Failed to update subscriber engagement', {
      tenantId,
      email,
      issueNumber,
      error: error.message
    });
  }
}
