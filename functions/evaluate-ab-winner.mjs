import { DynamoDBClient, GetItemCommand, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { evaluateAbResult } from './utils/ab-stats.mjs';
import { buildAbHistoryRecord } from './utils/ab-history.mjs';
import { publishIssueEvent, EVENT_TYPES } from './utils/event-publisher.mjs';

const ddb = new DynamoDBClient();
const eventBridge = new EventBridgeClient();

/**
 * Consumes an `Evaluate AB Test` EventBridge event, scores the per-variant
 * engagement stats with a two-proportion z-test, persists the decision on the
 * issue record, and sends the winning subject to the hold-out recipients.
 *
 * The handler is idempotent: once the abTest status is final (`sent` or
 * `inconclusive`) it never sends again. Errors are logged and swallowed
 * (returns false) so a permanently broken evaluation never retries forever.
 *
 * @param {{ detail: { tenantId: string, issueNumber: (number|string),
 *   referenceNumber: string, sendPayload: object } }} event
 * @returns {Promise<boolean>} true on success, false on (logged) failure.
 */
export const handler = async (event) => {
  try {
    const { detail } = event;
    console.log(JSON.stringify(detail));
    const { tenantId, issueNumber, sendPayload } = detail;
    const issueId = `${tenantId}#${issueNumber}`;

    const abTest = await getIssueAbTest(issueId);
    if (!abTest) {
      console.warn('No A/B test config found for issue, skipping evaluation', { issueId });
      return false;
    }

    // Fast-path idempotency: a fully-completed (or manually finalized) test.
    if (abTest.status === 'sent' || abTest.status === 'inconclusive') {
      console.log('A/B test already finalized, skipping evaluation', { issueId, status: abTest.status });
      return true;
    }

    // Atomically claim the evaluation so a duplicate or concurrent delivery
    // cannot also send the winner. abTest is stored as an opaque JSON string, so
    // the compare-and-swap is done on a dedicated top-level `abTestStatus`
    // attribute that mirrors the lifecycle state.
    const claimed = await claimEvaluation(issueId);
    if (!claimed) {
      console.log('A/B evaluation already claimed/finalized by another invocation, skipping', { issueId });
      return true;
    }

    try {
      const aCounters = await getVariantCounters(issueId, 'a');
      const bCounters = await getVariantCounters(issueId, 'b');

      const { winnerVariantId, status, evaluation } = evaluateAbResult(aCounters, bCounters, {
        winMetric: abTest.winMetric,
        confidence: abTest.confidence,
        minSamplePerVariant: abTest.minSamplePerVariant
      });

      // Inconclusive => fall back to the control (variant "a").
      const winningVariantId = winnerVariantId ?? 'a';
      const isSendTime = abTest.dimension === 'sendTime';
      const winningVariant = (abTest.variants || []).find((v) => v.variantId === winningVariantId);

      // Subject-line tests send the winning subject. Send-time tests keep the
      // shared subject and deliver the hold-out at the winning send time (or
      // immediately if that time has already passed).
      const winningSubject = isSendTime ? sendPayload?.subject : resolveSubject(abTest, winningVariantId);
      const winningSendAt = isSendTime ? winningVariant?.sendAt : undefined;
      if (isSendTime && winningSendAt) {
        evaluation.winningSendAt = winningSendAt;
      }

      // Enqueue the winner BEFORE marking the test final. Together with the claim
      // above this gives: exactly one invocation ever sends (no duplicate
      // emails), and if the publish fails the claim is released so a redelivery
      // retries instead of the test being stuck in a final state.
      await sendWinner(sendPayload, winningSubject, winningSendAt);

      const updatedAbTest = {
        ...abTest,
        evaluation,
        winnerVariantId: winningVariantId,
        status
      };
      await finalizeEvaluation(issueId, updatedAbTest, status);

      // Record the completed test in the tenant's cross-issue A/B history.
      // Best-effort: a failure here must not affect the (already enqueued) send.
      await writeAbHistory(tenantId, issueNumber, updatedAbTest, { a: aCounters, b: bCounters });

      await publishIssueEvent(
        tenantId,
        'system',
        EVENT_TYPES.ISSUE_AB_COMPLETED,
        {
          issueId,
          issueNumber,
          winnerVariantId: winningVariantId,
          status,
          evaluation
        }
      );

      return true;
    } catch (err) {
      // Release the claim so a redelivery can re-run the evaluation and send.
      await releaseEvaluationClaim(issueId);
      throw err;
    }
  } catch (err) {
    console.error(err);
    return false;
  }
};

// Lifecycle states (mirrored into the top-level `abTestStatus` attribute) that
// still allow a fresh evaluation to be claimed.
const CLAIMABLE_STATUSES = ['pending', 'testing'];
const CLAIM_STATUS = 'evaluating';

/**
 * Atomically claims the evaluation by moving `abTestStatus` to a transient
 * `evaluating` lock, only when it is currently unset or non-final. Returns false
 * when another invocation already owns or finalized the evaluation.
 * @param {string} issueId - `${tenantId}#${issueNumber}`.
 * @returns {Promise<boolean>} true when the claim was acquired.
 */
const claimEvaluation = async (issueId) => {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: 'newsletter' }),
      UpdateExpression: 'SET abTestStatus = :claim, updatedAt = :now',
      ConditionExpression:
        'attribute_not_exists(abTestStatus) OR abTestStatus = :pending OR abTestStatus = :testing',
      ExpressionAttributeValues: marshall({
        ':claim': CLAIM_STATUS,
        ':pending': CLAIMABLE_STATUSES[0],
        ':testing': CLAIMABLE_STATUSES[1],
        ':now': new Date().toISOString()
      })
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw err;
  }
};

/**
 * Persists the final evaluation result and the matching `abTestStatus`.
 * @param {string} issueId - `${tenantId}#${issueNumber}`.
 * @param {Object} updatedAbTest - The abTest config with evaluation/winner/status.
 * @param {string} status - Final status ('sent' | 'inconclusive').
 */
const finalizeEvaluation = async (issueId, updatedAbTest, status) => {
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: issueId, sk: 'newsletter' }),
    UpdateExpression: 'SET abTest = :v, abTestStatus = :status, updatedAt = :now',
    ExpressionAttributeValues: marshall({
      ':v': JSON.stringify(updatedAbTest),
      ':status': status,
      ':now': new Date().toISOString()
    })
  }));
};

/**
 * Records the completed test in the tenant's cross-issue A/B history. The record
 * is keyed by issue, so the PutItem is an idempotent upsert (a redelivery
 * overwrites rather than duplicating). Best-effort: failures are logged and
 * swallowed so history never affects the winner send or finalize.
 * @param {string} tenantId
 * @param {number|string} issueNumber
 * @param {Object} abTest - The finalized abTest config.
 * @param {Object} counters - Per-variant counters keyed by variantId.
 */
const writeAbHistory = async (tenantId, issueNumber, abTest, counters) => {
  try {
    const record = buildAbHistoryRecord({ tenantId, issueNumber, abTest, counters });
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(record, { removeUndefinedValues: true })
    }));
  } catch (err) {
    console.error('Failed to write A/B history record', { tenantId, issueNumber, error: err.message });
  }
};

/**
 * Releases a held evaluation claim back to a claimable state so a redelivery can
 * retry. Conditioned on the claim still being held to avoid clobbering a
 * concurrent finalize. Best-effort: failures are logged, not thrown.
 * @param {string} issueId - `${tenantId}#${issueNumber}`.
 */
const releaseEvaluationClaim = async (issueId) => {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: 'newsletter' }),
      UpdateExpression: 'SET abTestStatus = :testing, updatedAt = :now',
      ConditionExpression: 'abTestStatus = :claim',
      ExpressionAttributeValues: marshall({
        ':testing': CLAIMABLE_STATUSES[1],
        ':claim': CLAIM_STATUS,
        ':now': new Date().toISOString()
      })
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      console.error('Failed to release A/B evaluation claim', { issueId, error: err.message });
    }
  }
};

/**
 * Loads and parses the persisted A/B test config from the issue record.
 * @param {string} issueId - `${tenantId}#${issueNumber}`.
 * @returns {Promise<Object|null>} Parsed abTest config, or null when absent/invalid.
 */
const getIssueAbTest = async (issueId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: 'newsletter' }),
      ProjectionExpression: 'abTest'
    }));

    if (!result.Item) {
      return null;
    }

    const record = unmarshall(result.Item);
    if (!record.abTest) {
      return null;
    }

    return typeof record.abTest === 'string' ? JSON.parse(record.abTest) : record.abTest;
  } catch (err) {
    console.error('Failed to load A/B test config for issue', { issueId, error: err.message });
    return null;
  }
};

/**
 * Reads per-variant counters, defaulting any missing record or field to zero so
 * a missing variant stats row never breaks the evaluation.
 * @param {string} issueId - `${tenantId}#${issueNumber}`.
 * @param {('a'|'b')} variantId - Variant identifier.
 * @returns {Promise<{opens: number, clicks: number, deliveries: number}>}
 */
const getVariantCounters = async (issueId, variantId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: `stats#v#${variantId}` })
    }));

    if (!result.Item) {
      return { opens: 0, clicks: 0, deliveries: 0 };
    }

    const record = unmarshall(result.Item);
    return {
      opens: record.opens || 0,
      clicks: record.clicks || 0,
      deliveries: record.deliveries || 0
    };
  } catch (err) {
    console.error('Failed to read per-variant stats, defaulting to zero', { issueId, variantId, error: err.message });
    return { opens: 0, clicks: 0, deliveries: 0 };
  }
};

/**
 * Resolves the subject for the winning variant from the abTest config.
 * @param {Object} abTest - Parsed abTest config with a `variants` array.
 * @param {string} variantId - Winning variant identifier.
 * @returns {string|undefined} The winning subject, if found.
 */
const resolveSubject = (abTest, variantId) => {
  const variants = Array.isArray(abTest.variants) ? abTest.variants : [];
  const match = variants.find((v) => v.variantId === variantId);
  return match?.subject;
};

/**
 * Emits the `Send Email v2` event for the hold-out recipients. The detail is
 * the original sendPayload plus the winning subject, with no abTest/variants so
 * the send path treats it as a normal (non-split) send.
 * @param {Object} sendPayload - Everything needed to send except the subject.
 * @param {string} winningSubject - The chosen subject line.
 */
const sendWinner = async (sendPayload, winningSubject, winningSendAt) => {
  const { abTest: _abTest, variants: _variants, ...rest } = sendPayload || {};
  const detail = { ...rest, subject: winningSubject };

  // Send-time winner: deliver at the winning time when it is still in the
  // future; otherwise send immediately (send-email-v2 schedules future sends).
  if (winningSendAt && new Date(winningSendAt).getTime() > Date.now()) {
    detail.sendAt = winningSendAt;
  }

  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'newsletter-service',
      DetailType: 'Send Email v2',
      Detail: JSON.stringify(detail)
    }]
  }));
};
