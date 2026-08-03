import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';

const ddb = new DynamoDBClient();

/**
 * Prefix of a timeline item's sort key. Items sort chronologically within the
 * issue's partition because the timestamp follows it, so the whole timeline is
 * one `begins_with` query returned in order.
 */
export const TIMELINE_SK_PREFIX = 'event#';

/** How long a timeline outlives its issue. */
const TIMELINE_TTL_DAYS = 400;

/**
 * The recorded lifecycle of an issue.
 *
 * These are the transitions nothing else writes down. Deliberately absent:
 * `published` and `failed`, which the issue record already states
 * authoritatively in `publishedAt` and `failureReason`, and per-recipient
 * delivery, which the `sendProgress` record covers in far more detail. The API
 * derives the first pair at read time rather than storing the same fact twice,
 * where the two copies could disagree.
 *
 * `SEND_DEFERRED` is the one that pays for this whole mechanism. An issue that
 * publishes on a lead time hands its delivery to a Scheduler entry created
 * ~26 hours ahead of the send; when that entry does not fire, every other
 * signal says the issue was published successfully and nothing anywhere says
 * the mail never went. A recorded hand-off with no send after it makes that
 * gap the first thing an operator sees.
 */
export const ISSUE_EVENTS = {
  /** The issue record was created. */
  CREATED: 'created',
  /** Content or settings were edited while the issue was still a draft. */
  UPDATED: 'updated',
  /** A send was scheduled. `detail.sendAt` is the instant. */
  SCHEDULED: 'scheduled',
  /** A scheduled send was moved. `detail.from` / `detail.sendAt`. */
  RESCHEDULED: 'rescheduled',
  /** A scheduled send was cancelled and the issue returned to draft. */
  UNSCHEDULED: 'unscheduled',
  /** The publish workflow claimed the issue and began running. */
  WORKFLOW_STARTED: 'workflow_started',
  /** The rendered issue was handed to the send path. `detail.sendAt`. */
  SEND_HANDED_OFF: 'send_handed_off',
  /** Delivery was deferred to a future instant via a Scheduler entry. */
  SEND_DEFERRED: 'send_deferred',
  /** A local send was fanned out into per-timezone groups. */
  FANOUT_PLANNED: 'fanout_planned',
  /** Mail actually went to subscribers. `detail.recipients`. */
  SENDING_STARTED: 'sending_started',
  /** Every group finished. `detail.recipients` / `detail.skipped`. */
  SEND_COMPLETED: 'send_completed',
  /** An operator asked for the issue to be sent again. */
  RESEND_REQUESTED: 'resend_requested'
};

/**
 * Appends one event to an issue's timeline.
 *
 * **Never throws.** Every caller is on a path where the work that just happened
 * matters more than the note about it — failing a send because its own audit
 * entry could not be written would be the worst possible trade, and the reason
 * this is a plain write rather than something the caller has to handle. A lost
 * entry shows up as a gap in the timeline, which is exactly the shape of thing
 * the timeline exists to make visible.
 *
 * Written directly rather than published to EventBridge on purpose. The failure
 * this is meant to diagnose *was* a fire-and-forget hand-off that nothing
 * noticed; a recorder reachable only through another one would go dark in
 * precisely the incidents it was built for.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {number|string} params.issueNumber
 * @param {string} params.type - One of `ISSUE_EVENTS`
 * @param {string} [params.actor] - Who caused it: an email, or 'system'
 * @param {Object} [params.detail] - Small scalars only; not a payload dump
 * @param {string} [params.at] - ISO instant, defaults to now
 * @returns {Promise<boolean>} Whether the entry landed
 */
export const recordIssueEvent = async ({
  tenantId,
  issueNumber,
  type,
  actor = 'system',
  detail,
  at
}) => {
  if (!tenantId || issueNumber === undefined || issueNumber === null || !type) {
    console.warn('[TIMELINE] Skipping an event with no issue to attach it to', {
      tenantId,
      issueNumber,
      type
    });
    return false;
  }

  const timestamp = at ?? new Date().toISOString();

  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(
        {
          pk: `${tenantId}#${issueNumber}`,
          // The random suffix is a tiebreaker, not an identifier: two events in
          // the same millisecond are ordinary (fan-out plans then emits), and
          // without it the second would overwrite the first.
          sk: `${TIMELINE_SK_PREFIX}${timestamp}#${randomUUID().slice(0, 8)}`,
          type,
          at: timestamp,
          actor,
          ...(detail && Object.keys(detail).length > 0 && { detail }),
          ttl: Math.floor(Date.now() / 1000) + TIMELINE_TTL_DAYS * 24 * 60 * 60
        },
        { removeUndefinedValues: true }
      )
    }));

    return true;
  } catch (err) {
    console.error('[TIMELINE] Failed to record an issue event', {
      tenantId,
      issueNumber,
      type,
      error: err.message
    });
    return false;
  }
};

/**
 * The issue number out of a send reference (`<tenantId>_<issueNumber>`).
 *
 * The send path identifies issues by reference number rather than by number,
 * and a tenant id may itself contain an underscore — so the number is
 * everything after the LAST one, matching `issueIdFromReference` in
 * send-progress.mjs.
 *
 * @param {string|undefined} referenceNumber
 * @returns {string|null}
 */
export const issueNumberFromReference = (referenceNumber) => {
  if (!referenceNumber) return null;
  const issueNumber = referenceNumber.slice(referenceNumber.lastIndexOf('_') + 1);
  return issueNumber || null;
};
