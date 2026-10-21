import { DynamoDBClient, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SESv2Client, ListSuppressedDestinationsCommand } from '@aws-sdk/client-sesv2';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getTenant, sendWithRetry, throttle } from '../utils/helpers.mjs';
import { removeSubscriberAndDecrement } from '../utils/subscriber.mjs';
import { recordSuppression } from '../utils/suppression.mjs';
import { isSubscriberRecord } from '../utils/subscriber-record.mjs';
import { countSubscriberRows, reconcileSubscriberCount } from '../utils/subscriber-count.mjs';
import { assertEventsPublished } from '../utils/eventbridge.mjs';

const ddb = new DynamoDBClient();
const ses = new SESv2Client();
const eventBridge = new EventBridgeClient();

// Scheduled reconciliation is now a backstop for historical SES suppressions.
// Issue failedAddresses mixes hard bounces, temporary failures and rejects;
// it must never be used as evidence for deleting someone after two issues.
export const handler = async (event) => {
  const tenantId = typeof event.detail?.tenantId === 'string' ? event.detail.tenantId : event.detail?.tenantId?.id;
  if (!tenantId) throw new Error('Cleanup requires tenantId');
  const suppressed = new Map();
  let token;
  do {
    const response = await ses.send(new ListSuppressedDestinationsCommand({ NextToken: token, PageSize: 1000 }));
    for (const row of response.SuppressedDestinationSummaries || []) {
      if (['BOUNCE', 'COMPLAINT'].includes(row.Reason)) suppressed.set(row.EmailAddress.toLowerCase(), row.Reason);
    }
    token = response.NextToken;
  } while (token);
  let key;
  let removed = 0;
  do {
    const response = await ddb.send(new QueryCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenant',
      ExpressionAttributeValues: marshall({ ':tenant': tenantId }),
      ProjectionExpression: 'email', ConsistentRead: true, ExclusiveStartKey: key
    }));
    const tasks = (response.Items || []).map(unmarshall).filter(isSubscriberRecord)
      .filter(row => suppressed.has(row.email.toLowerCase())).map(row => async () => {
        const email = row.email.toLowerCase();
        // Suppress before removing: retries, imports and public signups cannot
        // silently restore a known bad address after its subscriber row is gone.
        await recordSuppression(tenantId, email, `ses-${suppressed.get(email).toLowerCase()}`);
        const didRemove = await sendWithRetry(() => removeSubscriberAndDecrement(tenantId, email));
        // The account suppression list has no originating issue. Only the live
        // delivery handler can attribute a removal using its message's issuePk.
        if (didRemove) removed++;
      });
    await throttle(tasks, 5);
    key = response.LastEvaluatedKey;
  } while (key);
  if (removed) {
    const subscribers = await checkSubscriberCount(tenantId);
    const tenant = await getTenant(tenantId);
    if (tenant?.email) {
      const result = await eventBridge.send(new PutEventsCommand({ Entries: [{
        Source: 'newsletter-service', DetailType: 'Send Email v2',
        Detail: JSON.stringify({ tenantId, to: { email: tenant.email },
          subject: `Subscriber Cleanup Report - ${removed} addresses removed`,
          html: `<p>Removed ${removed} subscribers confirmed on the SES bounce/complaint suppression list. Durable suppression prevents automatic re-subscription.</p><p>Current subscribers: ${subscribers ?? 'unknown'}.</p>` })
      }] }));
      assertEventsPublished(result, 'SES suppression reconciliation report');
    }
  }
  console.info('SES suppression reconciliation complete', { tenantId, removed });
  return { removed };
};

/**
 * The tenant's current subscriber count, for display in the operator's
 * notification email.
 *
 * A read, never a write. The previous version recounted the partition and
 * overwrote `tenant.subscribers` with the total, which raced with every live
 * signup and unsubscribe — a signup committing between the count and the write
 * was simply erased. Each removal above now maintains the count atomically, so
 * there is nothing left for this to repair and nothing it should overwrite.
 */
const readSubscriberCount = async (tenantId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: tenantId, sk: 'tenant' }),
      ProjectionExpression: '#subscribers',
      ExpressionAttributeNames: { '#subscribers': 'subscribers' },
      ConsistentRead: true
    }));

    const { subscribers } = result.Item ? unmarshall(result.Item) : {};
    return typeof subscribers === 'number' ? subscribers : null;
  } catch (error) {
    // The cleanup itself already succeeded; a failed read here should not fail
    // it. The email says "unknown" rather than a wrong number.
    console.error('Error reading subscriber count for notification:', error);
    return null;
  }
};

/**
 * Read the counter, count the rows, and reconcile the two.
 *
 * Returns the number the operator's email should quote: the row count when it
 * is known, since that is what the next send will actually reach, otherwise
 * the counter. A failure in the row count or the correction only costs the
 * drift check — the cleanup itself already succeeded and must not fail here.
 */
const checkSubscriberCount = async (tenantId) => {
  const stored = await readSubscriberCount(tenantId);

  try {
    const actual = await countSubscriberRows(tenantId);
    await reconcileSubscriberCount(tenantId, { stored, actual });
    return actual;
  } catch (error) {
    console.error('Error checking subscriber count for drift:', error);
    return stored;
  }
};
