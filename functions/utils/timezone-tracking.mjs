import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

let ddb;
function getClient() {
  if (!ddb) ddb = new DynamoDBClient();
  return ddb;
}

/** Distinct issues kept in the observation history. */
const TZ_HISTORY_MAX = 6;

/** Consecutive distinct-issue observations that must agree to confirm a timezone. */
export const TZ_CONFIRMATION_STREAK = 3;

/** Recognized observation sources. */
const OBSERVATION_SOURCES = new Set(['open', 'click']);

/**
 * Record a timezone observation for a subscriber and confirm their timezone
 * once the same zone is seen across TZ_CONFIRMATION_STREAK distinct issues.
 *
 * Semantics:
 * - One observation per issue, but click wins: a click-sourced observation
 *   REPLACES an open-sourced observation for the same issue; an open never
 *   replaces an existing observation, and a click never replaces a click.
 *   Apple Mail Privacy Protection proxies the open pixel through Apple
 *   datacenters, so open IPs geolocate to the wrong zone; click IPs are the
 *   reader's real device, so clicks are trusted over opens.
 * - History is a list of { issue, tz, source } on the subscriber record
 *   (tzHistory), ordered by issue number, capped at TZ_HISTORY_MAX entries.
 * - When the most recent TZ_CONFIRMATION_STREAK entries all agree, include at
 *   least one click-sourced observation, and differ from the stored timeZone,
 *   the subscriber's timeZone is set (with timeZoneUpdatedAt). An all-open
 *   streak never confirms. A subscriber who moves re-confirms the same way, so
 *   the stored zone follows them after three consistent issues.
 * - Optimistic concurrency: the update is conditional on tzHistory being
 *   unchanged since the read; a concurrent writer winning the race just means
 *   this observation is skipped (the next event re-observes).
 * - Errors are logged and never propagated (matches subscriber-engagement.mjs).
 *
 * @param {string} tenantId
 * @param {string} email - Subscriber email (sort key)
 * @param {number} issueNumber
 * @param {string} timeZone - IANA timezone name from geolocation
 * @param {'open'|'click'} source - Which event produced the observation
 */
export async function recordTimeZoneObservation(tenantId, email, issueNumber, timeZone, source) {
  if (!tenantId || !email || !timeZone || !Number.isFinite(issueNumber) || !OBSERVATION_SOURCES.has(source)) {
    return;
  }

  try {
    // "timeZone" must be aliased: TIMEZONE is a DynamoDB reserved word and
    // using it bare in any expression throws a ValidationException.
    const result = await getClient().send(new GetItemCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      Key: marshall({ tenantId, email }),
      ProjectionExpression: 'tzHistory, #timeZone',
      ExpressionAttributeNames: { '#timeZone': 'timeZone' }
    }));

    if (!result.Item) {
      // Not a known subscriber (e.g. manually-added recipient) — nothing to track.
      return;
    }

    const current = unmarshall(result.Item);
    const history = Array.isArray(current.tzHistory) ? current.tzHistory : [];

    const observation = { issue: issueNumber, tz: timeZone, source };
    const existingIndex = history.findIndex((entry) => entry.issue === issueNumber);

    let mergedHistory;
    if (existingIndex !== -1) {
      // Already observed for this issue. Only a click over a prior open wins;
      // open-over-anything and click-over-click are no-ops.
      if (source === 'click' && history[existingIndex].source === 'open') {
        mergedHistory = history.map((entry, index) => (index === existingIndex ? observation : entry));
      } else {
        return;
      }
    } else {
      mergedHistory = [...history, observation];
    }

    const newHistory = mergedHistory
      .sort((a, b) => a.issue - b.issue)
      .slice(-TZ_HISTORY_MAX);

    const confirmed = getConfirmedTimeZone(newHistory);
    const shouldSetTimeZone = confirmed !== null && confirmed !== current.timeZone;

    const expressionValues = {
      ':newHistory': newHistory,
      ...(history.length > 0 ? { ':oldHistory': history } : {})
    };

    let updateExpression = 'SET tzHistory = :newHistory';
    const expressionNames = {};
    if (shouldSetTimeZone) {
      updateExpression += ', #timeZone = :tz, timeZoneUpdatedAt = :now';
      expressionNames['#timeZone'] = 'timeZone';
      expressionValues[':tz'] = confirmed;
      expressionValues[':now'] = new Date().toISOString();
    }

    await getClient().send(new UpdateItemCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      Key: marshall({ tenantId, email }),
      UpdateExpression: updateExpression,
      ConditionExpression: history.length > 0
        ? 'tzHistory = :oldHistory'
        : 'attribute_not_exists(tzHistory)',
      ...(Object.keys(expressionNames).length > 0 && { ExpressionAttributeNames: expressionNames }),
      ExpressionAttributeValues: marshall(expressionValues)
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // A concurrent event updated the history first — skip this observation.
      return;
    }

    console.error('Failed to record timezone observation', {
      tenantId,
      email,
      issueNumber,
      error: error.message
    });
  }
}

/**
 * Return the timezone confirmed by the most recent TZ_CONFIRMATION_STREAK
 * distinct-issue observations, or null when the streak is too short, mixed, or
 * made up entirely of open-sourced observations.
 *
 * A confirming streak must both agree on a single zone AND contain at least one
 * click-sourced observation: opens come through Apple Mail Privacy Protection
 * proxies and can all point at the same (wrong) Apple datacenter zone, so an
 * all-open streak is not trustworthy on its own.
 *
 * @param {Array<{issue: number, tz: string, source: 'open'|'click'}>} history - Sorted by issue asc.
 * @returns {string|null}
 */
export function getConfirmedTimeZone(history) {
  if (!Array.isArray(history) || history.length < TZ_CONFIRMATION_STREAK) {
    return null;
  }

  const recent = history.slice(-TZ_CONFIRMATION_STREAK);
  const candidate = recent[0].tz;
  const allAgree = recent.every((entry) => entry.tz === candidate);
  const hasClick = recent.some((entry) => entry.source === 'click');
  return allAgree && hasClick ? candidate : null;
}
