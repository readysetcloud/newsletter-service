/**
 * Per-group send progress for local-send issues.
 *
 * A local-send issue does not finish when the state machine finishes. The
 * state machine's `Publish` step hands off to send-email-v2, which fans the
 * issue out into one scheduled send per timezone (or peak-hour) group plus a
 * catch-all, and returns. Deliveries then continue for hours — a 9am CDT issue
 * is still going out to UTC-11 subscribers at ~15:30 CDT. Without a record of
 * that, the issue reads as `published` while most subscribers have not received
 * it.
 *
 * This module persists the fan-out plan and each group's completion to a
 * dedicated `sendProgress` item so the API can report what is actually
 * happening. The item is separate from the `newsletter` record deliberately:
 * that record carries the full issue content, and charging a 200KB write for
 * each of a dozen group completions is pure waste.
 *
 * Two rules hold throughout:
 *
 * 1. **Nothing here ever throws.** Progress is bookkeeping; a failure to
 *    record it must never fail or delay a send. Every entry point logs and
 *    swallows (same contract as timezone-tracking.mjs).
 * 2. **Group updates are single-path SETs.** Concurrent group sends land on
 *    `groups.<label>` independently, so they cannot clobber each other the way
 *    a list append or a read-modify-write of the whole map would.
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

let ddb;
function getClient() {
  if (!ddb) ddb = new DynamoDBClient();
  return ddb;
}

/** Sort key of the progress item. One per issue. */
export const SEND_PROGRESS_SK = 'sendProgress';

/** A group that has been planned but whose send has not reported back yet. */
export const GROUP_PENDING = 'pending';
/** A group whose send completed and delivered to at least one recipient. */
export const GROUP_SENT = 'sent';
/** A group whose send completed with nothing to do (all recipients already sent). */
export const GROUP_EMPTY = 'empty';

/**
 * Derive the issue's DynamoDB partition key from a send reference number.
 * Mirrors the convention in markAbTestTesting: the issue number is everything
 * after the LAST underscore, because a tenant id may itself contain one.
 *
 * @param {string} tenantId
 * @param {string} referenceNumber - `<tenantId>_<issueNumber>`
 * @returns {string|null} `<tenantId>#<issueNumber>`, or null when unusable
 */
export const issueIdFromReference = (tenantId, referenceNumber) => {
  if (!tenantId || !referenceNumber) {
    return null;
  }
  const issueNumber = referenceNumber.slice(referenceNumber.lastIndexOf('_') + 1);
  return issueNumber ? `${tenantId}#${issueNumber}` : null;
};

/**
 * Build the progress document for a fan-out plan. Pure — the caller persists it.
 *
 * The catch-all is included as a group so completion accounts for it: it is the
 * backstop that sweeps anyone the per-group sends missed, and an issue is not
 * fully sent until it has run.
 *
 * @param {Object} params
 * @param {'timezone'|'peak-hour'} params.mode
 * @param {string} [params.defaultTimeZone] - Zone whose wall clock defined the target (timezone mode)
 * @param {Date} params.base - The issue's base send instant
 * @param {Date} params.catchAllAt - When the catch-all sweep runs
 * @param {Array<{label: string, sendTime: Date, size: number}>} params.plans - Planned groups
 * @param {string} params.catchAllLabel - Group key used for the catch-all
 * @param {number} params.totalSubscribers
 * @returns {Object} Progress document
 */
export const buildInitialProgress = ({
  mode,
  defaultTimeZone,
  base,
  catchAllAt,
  plans,
  catchAllLabel,
  totalSubscribers
}) => {
  const groups = {};
  for (const plan of plans) {
    groups[plan.label] = {
      label: plan.label,
      sendAt: plan.sendTime.toISOString(),
      size: plan.size,
      status: GROUP_PENDING
    };
  }
  groups[catchAllLabel] = {
    label: catchAllLabel,
    sendAt: catchAllAt.toISOString(),
    // The catch-all takes everyone; how many it actually sends to depends on
    // who the per-group sends missed, which is not knowable at plan time.
    size: null,
    status: GROUP_PENDING
  };

  return {
    mode,
    ...defaultTimeZone && { defaultTimeZone },
    baseAt: base.toISOString(),
    catchAllAt: catchAllAt.toISOString(),
    startedAt: new Date().toISOString(),
    totalSubscribers,
    groups
  };
};

/**
 * Whether every planned group has reported back. Pure.
 *
 * @param {{groups?: Object<string, {status?: string}>}} progress
 * @returns {boolean}
 */
export const isComplete = (progress) => {
  const groups = progress?.groups;
  if (!groups || typeof groups !== 'object') {
    return false;
  }
  const entries = Object.values(groups);
  return entries.length > 0 && entries.every((group) => group?.status && group.status !== GROUP_PENDING);
};

/**
 * Persist the fan-out plan and move the issue to `sending`.
 *
 * The status write is conditional on the issue being mid-flight. The state
 * machine's own `published` write races this one (Publish returns as soon as
 * the event is emitted, so the state machine can mark the issue published
 * before or after the fan-out runs) — the condition lets either order converge
 * on `sending`, and the state machine's write is conditional in the other
 * direction so it cannot clobber this one.
 *
 * @param {string} issueId - `<tenantId>#<issueNumber>`
 * @param {Object} progress - From buildInitialProgress
 */
export const startProgress = async (issueId, progress) => {
  if (!issueId) {
    return;
  }

  try {
    await getClient().send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: SEND_PROGRESS_SK }),
      UpdateExpression: 'SET #mode = :mode, defaultTimeZone = :defaultTimeZone, baseAt = :baseAt, '
        + 'catchAllAt = :catchAllAt, startedAt = :startedAt, totalSubscribers = :totalSubscribers, '
        + '#groups = :groups REMOVE completedAt',
      // A finished plan is never reopened by a redelivered event. EventBridge
      // delivers at least once, and this write resets every group to pending
      // and clears the completion stamp - so a duplicate of the original
      // local-send event would take a fully delivered issue back to `sending`
      // and recreate every group schedule. No duplicate email results (the
      // recipient filter sees to that), but the issue reads as in flight for
      // hours. A deliberate resend clears the record first, so it still gets a
      // fresh plan.
      ConditionExpression: 'attribute_not_exists(completedAt)',
      ExpressionAttributeNames: { '#mode': 'mode', '#groups': 'groups' },
      ExpressionAttributeValues: marshall({
        ':mode': progress.mode,
        ':defaultTimeZone': progress.defaultTimeZone ?? null,
        ':baseAt': progress.baseAt,
        ':catchAllAt': progress.catchAllAt,
        ':startedAt': progress.startedAt,
        ':totalSubscribers': progress.totalSubscribers,
        ':groups': progress.groups
      })
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log('[PROGRESS] Plan already completed - ignoring a duplicate fan-out', { issueId });
      return;
    }
    console.error('[PROGRESS] Failed to write fan-out plan', { issueId, error: error.message });
    return;
  }

  await setIssueStatus(issueId, {
    status: 'sending',
    // A resend re-runs the fan-out for an already-published issue, so
    // `published` is a legitimate starting point. `draft` is not: a stray
    // event must never resurrect an unsent issue.
    //
    // `failed` is here because the fan-out is ground truth about delivery and
    // the state machine is not. A post-publish task can fail in the gap between
    // the plan write above and this transition, and the failure write only
    // refuses once the record already reads `sending` - so it can land first
    // and leave a genuinely-sending issue marked `failed`. Without reclaiming
    // it, the terminal `sending -> published` transition can never apply
    // either: the issue stays `failed` with its delivery complete, and a failed
    // record is sendable, so re-staging it would send twice.
    from: ['in progress', 'published', 'sending', 'failed']
  });
};

/**
 * Mark one group's send as finished, and complete the issue when it was the
 * last one outstanding.
 *
 * Uses ReturnValues ALL_NEW so completion is evaluated against the state the
 * write produced, rather than a separate read that a concurrent group could
 * have invalidated.
 *
 * @param {string} issueId - `<tenantId>#<issueNumber>`
 * @param {string} label - Group key (timezone name, `hour-<n>`, `__default__`, `__catch_all__`)
 * @param {Object} result
 * @param {number} result.recipients - How many emails this group sent
 * @param {number} [result.skipped] - Recipients filtered as already-sent
 */
export const markGroupSent = async (issueId, label, { recipients, skipped = 0 }) => {
  if (!issueId || !label) {
    return;
  }

  let updated;
  try {
    const response = await getClient().send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: SEND_PROGRESS_SK }),
      UpdateExpression: 'SET #groups.#label.#status = :status, #groups.#label.sentAt = :now, '
        + '#groups.#label.recipients = :recipients, #groups.#label.skipped = :skipped',
      // Without the group entry there is no plan to update against. That means
      // the fan-out's write failed, so record nothing rather than inventing a
      // shape the API would then have to defend against.
      ConditionExpression: 'attribute_exists(#groups.#label)',
      ExpressionAttributeNames: { '#groups': 'groups', '#label': label, '#status': 'status' },
      ExpressionAttributeValues: marshall({
        ':status': recipients > 0 ? GROUP_SENT : GROUP_EMPTY,
        ':now': new Date().toISOString(),
        ':recipients': recipients,
        ':skipped': skipped
      }),
      ReturnValues: 'ALL_NEW'
    }));
    updated = response.Attributes ? unmarshall(response.Attributes) : null;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.warn('[PROGRESS] No planned group to update - skipping', { issueId, label });
      return;
    }
    console.error('[PROGRESS] Failed to mark group sent', { issueId, label, error: error.message });
    return;
  }

  if (!isComplete(updated)) {
    return;
  }

  // The status transition comes FIRST and is attempted regardless of whether
  // this call is the one that stamps completion.
  //
  // The obvious ordering — stamp completedAt, then publish, and skip both if
  // the stamp was already taken — has a hole with no way out of it. If the
  // stamp lands and the status write then fails transiently, the issue is
  // permanently `sending`: `completedAt` now exists, so a redelivered group
  // event fails the stamp's condition and returns before ever retrying the
  // status. Delivery is finished and the record disagrees, forever.
  //
  // Doing the status first means a failure there leaves `completedAt` unset, so
  // any later event retries both. Doing it unconditionally means a duplicate
  // delivery of the final group heals a status that was missed. Both writes are
  // conditional and idempotent, so the concurrent-finishers case the old early
  // return was avoiding costs one refused write and nothing else.
  console.log(`[PROGRESS] All groups delivered for ${issueId} - marking published`);
  const settled = await setIssueStatus(issueId, {
    status: 'published',
    // `failed` for the same reason the claim above accepts it: if the state
    // machine concluded failure while the send was in fact going out, the
    // completed delivery is the truer statement.
    from: ['sending', 'failed'],
    // The state machine may already have stamped publishedAt when it finished;
    // the first stamp is the more meaningful one (when the issue went out),
    // so it wins.
    stampPublishedAt: true
  });

  // Completion is only stamped once the record agrees. Stamping it after a
  // failed status write is what strands the issue: `attribute_not_exists`
  // would then refuse every later attempt, and with it the retry of the status
  // write that is actually outstanding. Leaving it unstamped costs a redundant
  // group update on redelivery and keeps the repair reachable.
  if (!settled) {
    return;
  }

  try {
    await updateWithRetry({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: SEND_PROGRESS_SK }),
      UpdateExpression: 'SET completedAt = :now',
      ConditionExpression: 'attribute_not_exists(completedAt)',
      ExpressionAttributeValues: marshall({ ':now': new Date().toISOString() })
    });
  } catch (error) {
    if (error.name !== 'ConditionalCheckFailedException') {
      console.error('[PROGRESS] Failed to stamp completion', { issueId, error: error.message });
    }
  }
};

/**
 * Send a conditional UpdateItem, retrying transient failures.
 *
 * Every write in this module is conditional and idempotent, so a retry is
 * always safe. ConditionalCheckFailedException is never retried: it is the
 * write being answered, not failing.
 *
 * @param {Object} input - UpdateItemCommand input
 * @param {number} [attempts] - Total attempts including the first
 * @returns {Promise<Object>} The command output
 */
const updateWithRetry = async (input, attempts = 3) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getClient().send(new UpdateItemCommand(input));
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException' || attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2 ** (attempt - 1) * 100));
    }
  }
};

/**
 * Transition the issue record's status, only from an expected prior state.
 *
 * @param {string} issueId
 * @param {Object} params
 * @param {string} params.status - Status to set
 * @param {string[]} params.from - Statuses this transition is valid from
 * @param {boolean} [params.stampPublishedAt] - Also set publishedAt if unset
 * @returns {Promise<boolean>} Whether the record is in the requested status -
 *   true when the write landed, or when the condition refused it BECAUSE the
 *   record already reads that status. A refusal for any other reason is false:
 *   the transition is genuinely outstanding and the caller must not treat the
 *   issue as settled.
 */
const setIssueStatus = async (issueId, { status, from, stampPublishedAt = false }) => {
  const names = { '#status': 'status' };
  const values = { ':status': status, ':now': new Date().toISOString() };
  from.forEach((value, index) => {
    values[`:from${index}`] = value;
  });

  let updateExpression = 'SET #status = :status, updatedAt = :now';
  if (stampPublishedAt) {
    updateExpression += ', publishedAt = if_not_exists(publishedAt, :now)';
  }

  try {
    // Retried: the terminal 'sending' -> 'published' transition is the last
    // thing that happens to a local-send issue, so there is no later event to
    // fix it if a transient failure is simply swallowed.
    await updateWithRetry({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: 'newsletter' }),
      UpdateExpression: updateExpression,
      ConditionExpression: `#status IN (${from.map((_, index) => `:from${index}`).join(', ')})`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values),
      // The refusal has to be interpretable, not just counted. Asking for the
      // item back on a condition failure is what lets the caller tell "already
      // there" from "somewhere else entirely" without a second read that could
      // observe a third state.
      ReturnValuesOnConditionCheckFailure: 'ALL_OLD'
    });
    return true;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // A refusal is not the same as being settled. The transition can lose a
      // race to the state machine's failure write, and treating the resulting
      // `failed` as success is how an issue ends up permanently `failed` with
      // its delivery complete - and eligible for a duplicate re-stage, since a
      // failed record is sendable. Only the record already reading the status
      // we asked for counts as settled.
      const current = error.Item ? unmarshall(error.Item).status : undefined;
      if (current === status) {
        console.log('[PROGRESS] Status already set, nothing to do', { issueId, status });
        return true;
      }

      console.error('[PROGRESS] Status transition refused by an unexpected status', {
        issueId,
        wanted: status,
        current: current ?? 'unknown',
        allowedFrom: from
      });
      return false;
    }
    console.error('[PROGRESS] Failed to set issue status', { issueId, status, error: error.message });
    return false;
  }
};
