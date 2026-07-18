import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

let ddb;
function getClient() {
  if (!ddb) ddb = new DynamoDBClient();
  return ddb;
}

/** Rolling per-subscriber activity entries kept, newest-first. */
const ACTIVITY_MAX = 20;

/** Recognized activity entry types. */
const ACTIVITY_TYPES = new Set(['open', 'click']);

/**
 * Append a behavioral activity entry (an open or a click) to a subscriber's
 * rolling recentActivity list. The list is newest-first and capped at
 * ACTIVITY_MAX entries; older entries fall off the end.
 *
 * Semantics:
 * - recentActivity is a list of { type, issue, ts, url? } on the subscriber
 *   record. url is only present for clicks.
 * - Optimistic concurrency: the update is conditional on recentActivity being
 *   unchanged since the read; a concurrent writer winning the race just means
 *   this entry is skipped (the next event re-records).
 * - Unknown subscribers (e.g. manually-added recipients with no record) are
 *   skipped without writing.
 * - Errors are logged and never propagated (matches subscriber-engagement.mjs).
 *
 * @param {string} tenantId
 * @param {string} email - Subscriber email (sort key)
 * @param {{ type: 'open'|'click', issue: number, ts: string, url?: string }} entry
 */
export async function recordActivity(tenantId, email, entry) {
  if (!tenantId || !email || !entry || !ACTIVITY_TYPES.has(entry.type) || !Number.isFinite(entry.issue) || !entry.ts) {
    return;
  }

  const activityEntry = {
    type: entry.type,
    issue: entry.issue,
    ts: entry.ts,
    ...(entry.type === 'click' && entry.url ? { url: entry.url } : {})
  };

  try {
    const result = await getClient().send(new GetItemCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      Key: marshall({ tenantId, email }),
      ProjectionExpression: 'recentActivity'
    }));

    if (!result.Item) {
      // Not a known subscriber (e.g. manually-added recipient) — nothing to track.
      return;
    }

    const current = unmarshall(result.Item);
    const history = Array.isArray(current.recentActivity) ? current.recentActivity : [];

    // Newest-first, capped at ACTIVITY_MAX.
    const newActivity = [activityEntry, ...history].slice(0, ACTIVITY_MAX);

    await getClient().send(new UpdateItemCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      Key: marshall({ tenantId, email }),
      UpdateExpression: 'SET recentActivity = :newActivity',
      ConditionExpression: history.length > 0
        ? 'recentActivity = :oldActivity'
        : 'attribute_not_exists(recentActivity)',
      ExpressionAttributeValues: marshall({
        ':newActivity': newActivity,
        ...(history.length > 0 ? { ':oldActivity': history } : {})
      })
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // A concurrent event updated the list first — skip this entry.
      return;
    }

    console.error('Failed to record subscriber activity', {
      tenantId,
      email,
      error: error.message
    });
  }
}

/**
 * Increment the open-hour histogram for a subscriber: bumps openHours.<hour>
 * (a string map key, hour 0-23 in UTC) and the openHourTotal counter by one.
 * This is a data foundation for a future peak-hour send feature — capture only.
 *
 * Uses the nested-map init pattern from interest-scoring.mjs updateInterestScore:
 * attempts the nested SET (openHours.<hour>), catches ValidationException when
 * the parent map does not exist yet, initializes openHours idempotently, then
 * retries exactly once. (DynamoDB ADD does not work on nested document paths, so
 * the hour bucket uses SET with if_not_exists; openHourTotal is a top-level
 * counter so it uses ADD.)
 *
 * Errors are logged and never propagated (matches subscriber-engagement.mjs).
 *
 * @param {string} tenantId
 * @param {string} email - Subscriber email (sort key)
 * @param {number} hour - UTC hour of the open, 0-23
 */
export async function recordOpenHour(tenantId, email, hour) {
  if (!tenantId || !email || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return;
  }

  const hourKey = String(hour);

  const buildIncrementCommand = () => new UpdateItemCommand({
    TableName: process.env.SUBSCRIBERS_TABLE_NAME,
    Key: marshall({ tenantId, email }),
    UpdateExpression: 'ADD openHourTotal :one SET openHours.#hour = if_not_exists(openHours.#hour, :zero) + :one',
    ExpressionAttributeNames: { '#hour': hourKey },
    ExpressionAttributeValues: marshall({ ':one': 1, ':zero': 0 })
  });

  try {
    await getClient().send(buildIncrementCommand());
  } catch (error) {
    if (error.name === 'ValidationException') {
      // The openHours map does not exist yet, so the nested path cannot be set.
      // Initialize it idempotently (so concurrent opens don't clobber each
      // other), then retry the increment once.
      try {
        await getClient().send(new UpdateItemCommand({
          TableName: process.env.SUBSCRIBERS_TABLE_NAME,
          Key: marshall({ tenantId, email }),
          UpdateExpression: 'SET openHours = if_not_exists(openHours, :emptyMap)',
          ExpressionAttributeValues: marshall({ ':emptyMap': {} })
        }));

        await getClient().send(buildIncrementCommand());
      } catch (retryError) {
        console.error('Failed to record open hour', {
          tenantId,
          email,
          hour,
          error: retryError.message
        });
      }
      return;
    }

    console.error('Failed to record open hour', {
      tenantId,
      email,
      hour,
      error: error.message
    });
  }
}
