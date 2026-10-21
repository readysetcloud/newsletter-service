import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { removeSubscriberAndDecrement } from './subscriber.mjs';
import { incrementIssueCounter } from './issue-attribution.mjs';

const ddb = new DynamoDBClient();
const HISTORY_LIMIT = 50;
const SOFT_BOUNCE_LIMIT = 3;

async function removeSuppressedSubscriber(tenantId, email, outcome) {
  const removed = await removeSubscriberAndDecrement(tenantId, email);
  if (removed && outcome.issuePk) {
    try { await incrementIssueCounter(outcome.issuePk, 'cleaned'); }
    catch (error) { console.warn('Delivery cleanup attribution failed', { error: error.name }); }
  }
}

/** Send-time ordering makes delayed callbacks unable to undo newer delivery. */
export function nextDeliveryHealth(previous, outcome) {
  const history = [...(previous.history || [])];
  const existing = history.findIndex(item => item.id === outcome.id);
  // A delivery for this same send is stronger evidence than a soft failure.
  if (existing < 0) history.push(outcome);
  else if (history[existing].kind !== 'delivery' && outcome.kind === 'delivery') history[existing] = outcome;
  history.sort((a, b) => b.sentAt.localeCompare(a.sentAt) || b.id.localeCompare(a.id));
  const bounded = history.slice(0, HISTORY_LIMIT);
  let consecutiveSoftBounces = 0;
  for (const item of bounded) {
    if (item.kind !== 'temporary') break;
    consecutiveSoftBounces++;
  }
  const suppressionReason = previous.suppressionReason ||
    (outcome.kind === 'permanent' ? 'hard-bounce' :
      outcome.kind === 'suppressed' ? 'ses-suppressed' :
        consecutiveSoftBounces >= SOFT_BOUNCE_LIMIT ? 'repeated-soft-bounce' : null);
  return { history: bounded, consecutiveSoftBounces, ...(suppressionReason && { suppressionReason }) };
}

/** Persist dedup, streak and any suppression atomically, then remove the row.
 * A failure removing the row is retried; the durable suppression already blocks
 * sends and re-imports. A retry of the same SES event never advances the streak.
 */
export async function recordDeliveryOutcome(tenantId, emailAddress, outcome) {
  const email = emailAddress.trim().toLowerCase();
  const key = { pk: tenantId, sk: `delivery-health#${email}` };
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME, Key: marshall(key), ConsistentRead: true
    }));
    const previous = response.Item ? unmarshall(response.Item) : {};
    const next = nextDeliveryHealth(previous, outcome);
    const changed = JSON.stringify(next.history) !== JSON.stringify(previous.history) || next.suppressionReason !== previous.suppressionReason;
    if (!changed) {
      if (next.suppressionReason) await removeSuppressedSubscriber(tenantId, email, outcome);
      return next;
    }
    const now = new Date().toISOString();
    const items = [{ Put: {
      TableName: process.env.TABLE_NAME,
      Item: marshall({ ...key, ...next, revision: (previous.revision || 0) + 1, updatedAt: now }),
      ConditionExpression: response.Item ? 'revision = :revision' : 'attribute_not_exists(pk)',
      ...(response.Item && { ExpressionAttributeValues: marshall({ ':revision': previous.revision }) })
    } }];
    if (next.suppressionReason) items.push({ Update: {
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: tenantId, sk: `suppression#${email}` }),
      // Preserve prior consent revocations and verified ownership evidence.
      UpdateExpression: 'SET unsubscribedAt = if_not_exists(unsubscribedAt, :now), #method = if_not_exists(#method, :method), verified = if_not_exists(verified, :false), email = :email, lastUnsubscribedAt = :now, lastMethod = :method, lastVerified = :false',
      ExpressionAttributeNames: { '#method': 'method' },
      ExpressionAttributeValues: marshall({ ':now': now, ':method': next.suppressionReason, ':email': email, ':false': false })
    } });
    try {
      await ddb.send(new TransactWriteItemsCommand({ TransactItems: items }));
    } catch (error) {
      const codes = (error.CancellationReasons || []).map(reason => reason.Code).filter(code => code && code !== 'None');
      if (attempt < 4 && error.name === 'TransactionCanceledException' && codes.length &&
          codes.every(code => ['ConditionalCheckFailed', 'TransactionConflict', 'ThrottlingError', 'ProvisionedThroughputExceeded'].includes(code))) continue;
      throw error;
    }
    if (next.suppressionReason) await removeSuppressedSubscriber(tenantId, email, outcome);
    return next;
  }
  throw new Error('Delivery health contention exceeded retries');
}
