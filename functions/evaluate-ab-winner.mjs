import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { evaluateAbResult } from './utils/ab-stats.mjs';
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

    // Idempotency guard: never evaluate/send a finished test twice.
    if (abTest.status === 'sent' || abTest.status === 'inconclusive') {
      console.log('A/B test already finalized, skipping evaluation', { issueId, status: abTest.status });
      return true;
    }

    const aCounters = await getVariantCounters(issueId, 'a');
    const bCounters = await getVariantCounters(issueId, 'b');

    const { winnerVariantId, status, evaluation } = evaluateAbResult(aCounters, bCounters, {
      winMetric: abTest.winMetric,
      confidence: abTest.confidence,
      minSamplePerVariant: abTest.minSamplePerVariant
    });

    // Inconclusive => fall back to the control (variant "a").
    const winningVariantId = winnerVariantId ?? 'a';
    const winningSubject = resolveSubject(abTest, winningVariantId);

    const updatedAbTest = {
      ...abTest,
      evaluation,
      winnerVariantId: winningVariantId,
      status
    };

    const now = new Date().toISOString();
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: 'newsletter' }),
      UpdateExpression: 'SET abTest = :v, updatedAt = :now',
      ExpressionAttributeValues: marshall({
        ':v': JSON.stringify(updatedAbTest),
        ':now': now
      })
    }));

    await sendWinner(sendPayload, winningSubject);

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
    console.error(err);
    return false;
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
const sendWinner = async (sendPayload, winningSubject) => {
  const { abTest: _abTest, variants: _variants, ...rest } = sendPayload || {};
  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'newsletter-service',
      DetailType: 'Send Email v2',
      Detail: JSON.stringify({
        ...rest,
        subject: winningSubject
      })
    }]
  }));
};
