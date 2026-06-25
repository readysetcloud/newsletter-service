import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

/**
 * Deletes a draft issue once its ttlSeconds has expired. Triggered by a
 * one-time EventBridge schedule (created by POST /issues) that emits a
 * DELETE_EXPIRED_DRAFT event. The delete is conditional on the issue still
 * being a draft, so an issue that was published or scheduled before expiry is
 * left untouched.
 */
export const handler = async (event) => {
  const detail = event?.detail || {};
  const { tenantId, issueNumber } = detail;

  if (!tenantId || issueNumber === undefined || issueNumber === null) {
    console.error('Missing required parameters', { tenantId, issueNumber });
    return { deleted: false, reason: 'missing-parameters' };
  }

  const pk = `${tenantId}#${issueNumber}`;

  try {
    await ddb.send(new DeleteItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk, sk: 'newsletter' }),
      ConditionExpression: '#status = :draft',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({ ':draft': 'draft' }),
    }));

    console.log('Deleted expired draft', { tenantId, issueNumber });
    return { deleted: true, tenantId, issueNumber };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log('Draft no longer eligible for deletion (status changed or already removed)', { tenantId, issueNumber });
      return { deleted: false, reason: 'not-draft' };
    }
    console.error('Failed to delete expired draft', { tenantId, issueNumber, error: err.message });
    throw err;
  }
};
