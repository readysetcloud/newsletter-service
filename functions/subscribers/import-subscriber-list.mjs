import { DynamoDBClient, UpdateItemCommand, TransactWriteItemsCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { getTenant, formatResponse, throttle, sendWithRetry } from "../utils/helpers.mjs";
import { sanitizeName } from "../utils/subscriber-name.mjs";
import { SEGMENT_KEY_PREFIX } from "../utils/subscriber-record.mjs";
import { getSuppression, suppressionConditionCheck } from "../utils/suppression.mjs";

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const { tenantId, list } = event;
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return formatResponse(404, 'Tenant not found');
    }

    const tasks = list.items.map(item => () => addSubscriber(tenantId, item));
    console.log(`Processing ${tasks.length} contacts with throttling enabled`);

    // Track failures during import while keeping bounded concurrency.
    //
    // Outcomes are counted, not inferred. `imported` used to be total minus
    // failures minus suppressions, which quietly counted addresses that were
    // already subscribers: re-importing a 100-address list where 99 already
    // existed reported 99 more imports than actually happened, and the
    // operator had no way to see that from the result.
    const results = [];
    const suppressed = [];
    let created = 0;
    let existing = 0;
    const trackedTasks = tasks.map(task => async () => {
      try {
        const outcome = await task();
        if (outcome?.suppressed) {
          suppressed.push(outcome.email);
        } else if (outcome?.existing) {
          existing++;
        } else {
          created++;
        }
        results.push({ status: 'fulfilled' });
      } catch (error) {
        results.push({ status: 'rejected', reason: error });
      }
    });
    await throttle(trackedTasks, 5);
    const failures = results.filter(r => r.status === 'rejected');

    if (suppressed.length > 0) {
      // Named, not just counted: the operator needs to know exactly which
      // addresses were withheld so "why isn't X on my list" has an answer.
      console.log(`Skipped ${suppressed.length} unsubscribed addresses:`, suppressed);
    }

    if (failures.length > 0) {
      console.error(`Import completed with ${failures.length} failures out of ${tasks.length} total`);
      failures.forEach((failure, idx) => {
        console.error(`Failed item ${idx}:`, failure.reason?.message || failure.reason);
      });

      // Update count with successful imports only
      await updateSubscriberCount(tenantId);

      // Return partial success with failure details
      return {
        success: false,
        imported: created,
        existing,
        failed: failures.length,
        suppressed: suppressed.length,
        suppressedAddresses: suppressed,
        total: tasks.length,
        errors: failures.map(f => f.reason?.message || String(f.reason))
      };
    }

    await updateSubscriberCount(tenantId);
    console.log(`Successfully added ${created} contacts (${existing} already subscribed)`);

    return {
      success: true,
      imported: created,
      existing,
      failed: 0,
      suppressed: suppressed.length,
      suppressedAddresses: suppressed,
      total: list.items.length
    };
  } catch (err) {
    console.error('Error in Lambda:', err.message);
    console.error(err.stack);
    return {
      success: false,
      error: err.message
    };
  }
};

const addSubscriber = async (tenantId, contact) => {
  const addedAt = new Date().toISOString();

  const normalizedEmail = contact.address.toLowerCase();

  // An import is the operator acting, not the subscriber, so it cannot restore
  // consent: a list snapshot that predates someone's unsubscribe would silently
  // put them back on the list — the classic way opted-out people get mailed
  // again.
  //
  // A failed lookup fails the address rather than importing it. "No suppression
  // on record" and "could not reach the consent store" are different facts, and
  // only the first is permission to add someone; the address surfaces in the
  // import result's errors so the operator can retry it.
  let suppression;
  try {
    suppression = await getSuppression(tenantId, normalizedEmail);
  } catch (err) {
    throw new Error(`Could not read consent state for ${normalizedEmail}, not imported: ${err.message}`);
  }

  if (suppression) {
    console.log(`Skipping ${normalizedEmail}; unsubscribed on ${suppression.unsubscribedAt} via ${suppression.method}`);
    return { suppressed: true, email: normalizedEmail };
  }

  const firstName = sanitizeName(contact.firstName);
  const lastName = sanitizeName(contact.lastName);

  const subscriberItem = {
    tenantId,
    email: normalizedEmail,
    addedAt,
    ...(firstName && { firstName }),
    ...(lastName && { lastName })
  };

  try {
    // A transaction, not a batch write, for two reasons. It commits the consent
    // check with the write, so an unsubscribe landing mid-import cannot end
    // with an active subscriber and a suppression on record at once. And it
    // supports conditions at all: the previous `BatchWriteItem` did not, so the
    // guard against overwriting an existing subscriber never applied — a
    // re-import replaced live rows and wiped their engagement and interest
    // data, and the `ConditionalCheckFailedException` catch below it could
    // never fire.
    await sendWithRetry(() => ddb.send(new TransactWriteItemsCommand({
      TransactItems: [
        suppressionConditionCheck(tenantId, normalizedEmail),
        {
          Put: {
            TableName: process.env.SUBSCRIBERS_TABLE_NAME,
            Item: marshall(subscriberItem),
            ConditionExpression: 'attribute_not_exists(tenantId)'
          }
        }
      ]
    })), 'TransactWriteItems');
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      const codes = (err.CancellationReasons || []).map((reason) => reason.Code);
      // Guard order matches TransactItems: [suppression check, subscriber put].
      if (codes[0] === 'ConditionalCheckFailed') {
        console.log(`Skipping ${normalizedEmail}; a suppression landed during the import`);
        return { suppressed: true, email: normalizedEmail };
      }
      if (codes[1] === 'ConditionalCheckFailed') {
        console.info(`Subscriber ${normalizedEmail} already exists, leaving their record untouched`);
        return { existing: true, email: normalizedEmail };
      }
    }

    // All other errors (IAM, validation, throttling) should fail the import
    console.error(`Failed to add subscriber ${contact.address}:`, err.message);
    throw err;
  }
};

/**
 * Count a tenant's actual subscribers.
 *
 * Two things a plain `Select: 'COUNT'` over the tenant partition got wrong.
 * The segments feature stores its own records in this table under the same
 * partition, overloading the `email` sort key (`SEGMENT#...`, memberships,
 * name guards, rebuild jobs), so counting the partition counted bookkeeping
 * rows as subscribers and overstated every segment-using tenant. The filter
 * excludes that namespace DynamoDB-side; `Select: 'COUNT'` still returns the
 * post-filter count, so nothing is paid to transfer items.
 *
 * And this runs immediately after the import's own writes, where an
 * eventually consistent read can miss rows that just committed — and then
 * overwrite the stored count with the low number. Strongly consistent because
 * it is a repair, and a repair that reads stale data writes damage.
 */
const getSubscriberCount = async (tenantId) => {
  let total = 0;
  let lastEvaluatedKey;

  do {
    const response = await sendWithRetry(() => ddb.send(new QueryCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenantId',
      FilterExpression: 'NOT begins_with(#email, :segmentPrefix)',
      ExpressionAttributeNames: { '#email': 'email' },
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':segmentPrefix': SEGMENT_KEY_PREFIX
      }),
      Select: 'COUNT',
      ConsistentRead: true,
      ExclusiveStartKey: lastEvaluatedKey
    })), 'QuerySubscriberCount');

    total += response.Count || 0;
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return total;
};

const updateSubscriberCount = async (tenantId) => {
  const count = await getSubscriberCount(tenantId);
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'tenant'
    }),
    UpdateExpression: 'SET #subscribers = :val',
    ExpressionAttributeNames: {
      '#subscribers': 'subscribers'
    },
    ExpressionAttributeValues: {
      ':val': { N: `${count}` }
    }
  }));
};
