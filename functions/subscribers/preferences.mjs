import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { decrypt } from '../utils/helpers.mjs';
import {
  TOPICS,
  VALID_TOPICS,
  AUTO_SEGMENT_THRESHOLD,
  getTopicDisplayName
} from '../utils/topic-taxonomy.mjs';
import {
  findOrCreateInterestSegment,
  addSubscriberToSegment
} from '../utils/interest-scoring.mjs';

const ddb = new DynamoDBClient();

/**
 * Subscriber-facing preference center ("we think you like X — correct us").
 *
 * A single Lambda serves both routes on /{tenant}/preferences:
 *   - GET  renders a standalone HTML page showing the topics we've inferred for
 *          the subscriber (from click-based interestScores), plus the full topic
 *          taxonomy so they can add interests, plus a per-topic "not interested"
 *          exclusion control.
 *   - POST applies the submitted corrections. Corrections are zero-party data
 *          and beat click signal, so a preferred topic is floored to the
 *          auto-segment threshold (and joins the auto segment) while an excluded
 *          topic is removed from scoring and recorded in `excludedTopics`, which
 *          the automatic scorer honours (see interest-scoring.mjs).
 *
 * This is a PUBLIC, unauthenticated surface. The encrypted email token is the
 * only credential; it is never echoed into HTML in plaintext, the email address
 * is displayed masked, every interpolated value is HTML-escaped, and a bad token
 * yields a uniform error page that never reveals whether an address exists.
 */

export const handler = async (event) => {
  const tenantId = event.pathParameters?.tenant;
  const method = (event.httpMethod || 'GET').toUpperCase();

  try {
    if (!tenantId) {
      return htmlResponse(errorPage());
    }

    if (method === 'POST') {
      return await handlePost(event, tenantId);
    }

    return await handleGet(event, tenantId);
  } catch (err) {
    console.error('Preference center error:', {
      error: err.message,
      tenantId,
      method,
      stack: err.stack
    });
    return htmlResponse(errorPage());
  }
};

const handleGet = async (event, tenantId) => {
  const token = event.queryStringParameters?.email;
  const emailAddress = tryDecrypt(token, tenantId);
  if (!emailAddress) {
    return htmlResponse(errorPage());
  }

  const subscriber = await getSubscriber(tenantId, emailAddress);
  const interestScores = subscriber?.interestScores || {};
  const excluded = toStringArray(subscriber?.excludedTopics);

  return htmlResponse(preferencesPage({
    tenantId,
    token,
    emailAddress,
    interestScores,
    excluded
  }));
};

const handlePost = async (event, tenantId) => {
  const params = parseFormBody(event);
  const token = params.get('email') || params.get('token');
  const emailAddress = tryDecrypt(token, tenantId);
  if (!emailAddress) {
    return htmlResponse(errorPage());
  }

  // Exclusion always wins over preference when a topic is submitted as both, so
  // build the excluded set first and subtract it from the preferred set.
  const excludedTopics = uniqueValidTopics(params.getAll('exclude'));
  const excludedSet = new Set(excludedTopics);
  const preferredTopics = uniqueValidTopics(params.getAll('prefer'))
    .filter((topic) => !excludedSet.has(topic));

  const subscriber = await getSubscriber(tenantId, emailAddress);

  // Unknown subscriber (e.g. already deleted): render the confirmation page
  // without writing, so the response is indistinguishable from a real one and
  // no phantom subscriber row is created.
  if (subscriber) {
    for (const topic of preferredTopics) {
      await applyPreferred(tenantId, emailAddress, topic, subscriber.interestScores?.[topic]?.score);
    }
    for (const topic of excludedTopics) {
      await applyExcluded(tenantId, emailAddress, topic);
    }
    await touchPreferencesTimestamp(tenantId, emailAddress);
  }

  return htmlResponse(confirmationPage({
    tenantId,
    emailAddress,
    preferredTopics,
    excludedTopics
  }));
};

/* --------------------------------------------------------------------------
 * Mutations
 * ------------------------------------------------------------------------ */

/**
 * Mark a topic as preferred. Floors the score to the auto-segment threshold
 * (never lowering an already-higher score), clears any prior exclusion, and
 * joins the matching auto interest segment using the shared membership helper.
 */
const applyPreferred = async (tenantId, email, topic, currentScore) => {
  const now = new Date().toISOString();
  const targetScore = Math.max(Number(currentScore) || 0, AUTO_SEGMENT_THRESHOLD);

  const buildSetCommand = () => new UpdateItemCommand({
    TableName: process.env.SUBSCRIBERS_TABLE_NAME,
    Key: marshall({ tenantId, email }),
    // A preference clears a prior exclusion for the same topic — the subscriber
    // just told us the opposite of what an earlier exclusion recorded.
    UpdateExpression: 'SET interestScores.#topic.score = :score, interestScores.#topic.lastScoredAt = :now DELETE excludedTopics :topicSet',
    ExpressionAttributeNames: { '#topic': topic },
    ExpressionAttributeValues: marshall({
      ':score': targetScore,
      ':now': now,
      ':topicSet': new Set([topic])
    })
  });

  try {
    await ddb.send(buildSetCommand());
  } catch (error) {
    if (error.name === 'ValidationException') {
      // Nested path interestScores.<topic> does not exist yet — initialize both
      // levels (same pattern as automatic scoring), then retry once.
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.SUBSCRIBERS_TABLE_NAME,
        Key: marshall({ tenantId, email }),
        UpdateExpression: 'SET interestScores = if_not_exists(interestScores, :emptyMap)',
        ExpressionAttributeValues: marshall({ ':emptyMap': {} })
      }));
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.SUBSCRIBERS_TABLE_NAME,
        Key: marshall({ tenantId, email }),
        UpdateExpression: 'SET interestScores.#topic = if_not_exists(interestScores.#topic, :zeroEntry)',
        ExpressionAttributeNames: { '#topic': topic },
        ExpressionAttributeValues: marshall({ ':zeroEntry': { score: 0, lastScoredAt: now } })
      }));
      await ddb.send(buildSetCommand());
    } else {
      throw error;
    }
  }

  const segmentId = await findOrCreateInterestSegment(tenantId, topic);
  if (segmentId) {
    await addSubscriberToSegment(tenantId, email, segmentId);
  }
};

/**
 * Mark a topic as excluded. Removes the inferred score, records the topic in the
 * `excludedTopics` string set (which the automatic scorer honours), and removes
 * the subscriber from the matching auto segment if they were a member.
 */
const applyExcluded = async (tenantId, email, topic) => {
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.SUBSCRIBERS_TABLE_NAME,
    Key: marshall({ tenantId, email }),
    UpdateExpression: 'REMOVE interestScores.#topic ADD excludedTopics :topicSet',
    ExpressionAttributeNames: { '#topic': topic },
    ExpressionAttributeValues: marshall({ ':topicSet': new Set([topic]) })
  }));

  await removeFromInterestSegment(tenantId, email, topic);
};

/**
 * Removes the subscriber from a topic's auto interest segment, if it exists and
 * they are a member. Looks the segment up via the uniqueness record (never
 * creating one), deletes the member row conditionally, and decrements
 * memberCount with floor-at-zero protection (mirrors segment-membership-cleanup).
 */
const removeFromInterestSegment = async (tenantId, email, topic) => {
  const tableName = process.env.SUBSCRIBERS_TABLE_NAME;

  const uniqueness = await ddb.send(new GetItemCommand({
    TableName: tableName,
    Key: marshall({ tenantId, email: `SEGMENT_NAME#auto: ${topic}` }),
    ProjectionExpression: 'segmentId'
  }));
  if (!uniqueness.Item) {
    return;
  }
  const { segmentId } = unmarshall(uniqueness.Item);
  if (!segmentId) {
    return;
  }

  try {
    await ddb.send(new DeleteItemCommand({
      TableName: tableName,
      Key: marshall({ tenantId, email: `SEGMENT#${segmentId}#MEMBER#${email}` }),
      ConditionExpression: 'attribute_exists(email)'
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Not a member — nothing to decrement.
      return;
    }
    throw error;
  }

  try {
    await ddb.send(new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ tenantId, email: `SEGMENT#${segmentId}` }),
      UpdateExpression: 'SET memberCount = if_not_exists(memberCount, :zero) - :one',
      ConditionExpression: 'attribute_exists(memberCount) AND memberCount >= :one',
      ExpressionAttributeValues: marshall({ ':one': 1, ':zero': 0 })
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Floor at zero — count would go negative, so pin it to 0.
      await ddb.send(new UpdateItemCommand({
        TableName: tableName,
        Key: marshall({ tenantId, email: `SEGMENT#${segmentId}` }),
        UpdateExpression: 'SET memberCount = :zero',
        ExpressionAttributeValues: marshall({ ':zero': 0 })
      }));
    } else {
      throw error;
    }
  }
};

const touchPreferencesTimestamp = async (tenantId, email) => {
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.SUBSCRIBERS_TABLE_NAME,
    Key: marshall({ tenantId, email }),
    UpdateExpression: 'SET preferencesUpdatedAt = :now',
    ExpressionAttributeValues: marshall({ ':now': new Date().toISOString() })
  }));
};

/* --------------------------------------------------------------------------
 * Data access + parsing helpers
 * ------------------------------------------------------------------------ */

const getSubscriber = async (tenantId, email) => {
  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.SUBSCRIBERS_TABLE_NAME,
    Key: marshall({ tenantId, email })
  }));
  return result.Item ? unmarshall(result.Item) : null;
};

const tryDecrypt = (token, tenantId) => {
  if (!token) {
    return null;
  }
  try {
    return decrypt(token);
  } catch (err) {
    console.error('Preference token decryption failed:', {
      error: err.message,
      tenantId,
      tokenLength: token ? token.length : 0
    });
    return null;
  }
};

const parseFormBody = (event) => {
  let body = event.body || '';
  if (event.isBase64Encoded) {
    body = Buffer.from(body, 'base64').toString('utf8');
  }
  return new URLSearchParams(body);
};

const uniqueValidTopics = (values) => {
  const seen = new Set();
  for (const value of values) {
    if (VALID_TOPICS.has(value)) {
      seen.add(value);
    }
    // Unknown topics are rejected silently.
  }
  return [...seen];
};

/** Normalizes a DynamoDB string-set/list attribute into a plain string array. */
const toStringArray = (value) => {
  if (!value) {
    return [];
  }
  if (value instanceof Set) {
    return [...value];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [];
};

/* --------------------------------------------------------------------------
 * HTML rendering (no external JS; inline CSS matching the unsubscribe page)
 * ------------------------------------------------------------------------ */

/**
 * Escapes a value for safe interpolation into HTML text and double-quoted
 * attributes. Everything user- or token-derived passes through this.
 */
export const escapeHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/** Masks an email address, e.g. jane@example.com -> j***@example.com. */
export const maskEmail = (email) => {
  const value = String(email || '');
  const at = value.indexOf('@');
  if (at <= 0) {
    return '***';
  }
  const first = value[0];
  const domain = value.slice(at + 1);
  return `${first}***@${domain}`;
};

const PAGE_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: linear-gradient(135deg, #f0f4f8 0%, #d9e2ec 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    line-height: 1.6;
  }
  .card {
    background: white;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    max-width: 620px;
    width: 100%;
    overflow: hidden;
  }
  .header {
    background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
    padding: 40px 30px;
    text-align: center;
    color: white;
  }
  .icon-circle {
    width: 80px; height: 80px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 20px;
  }
  .icon { font-size: 44px; }
  .header h1 { font-size: 26px; font-weight: 600; margin-bottom: 8px; }
  .header p { font-size: 15px; opacity: 0.95; }
  .content { padding: 36px 30px; }
  .message { text-align: center; color: #4a5568; font-size: 15px; margin-bottom: 24px; }
  .message strong { color: #2d3748; }
  .subscriber { text-align: center; color: #718096; font-size: 13px; margin-bottom: 24px; }
  .section-title { font-size: 17px; color: #2d3748; font-weight: 600; margin: 24px 0 6px; }
  .section-help { font-size: 13px; color: #718096; margin-bottom: 14px; }
  .divider { height: 1px; background: linear-gradient(to right, transparent, #e2e8f0, transparent); margin: 26px 0; }
  .topic-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 12px 14px; border: 1px solid #e2e8f0;
    border-radius: 10px; margin-bottom: 10px; background: #f7fafc;
  }
  .topic-name { font-size: 15px; color: #2d3748; font-weight: 500; }
  .topic-score { font-size: 12px; color: #a0aec0; margin-left: 8px; font-weight: 400; }
  .topic-controls { display: flex; gap: 18px; flex-shrink: 0; }
  .control { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #4a5568; }
  .control input { width: 16px; height: 16px; cursor: pointer; }
  .control.exclude { color: #c53030; }
  .btn {
    width: 100%; padding: 14px 24px; font-size: 15px; font-weight: 600;
    border: none; border-radius: 8px; cursor: pointer; font-family: inherit;
    background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%); color: white;
    margin-top: 26px;
  }
  .footer { text-align: center; padding: 18px 30px; background: #f7fafc; color: #718096; font-size: 13px; }
  @media (max-width: 600px) {
    .topic-row { flex-direction: column; align-items: flex-start; }
    .topic-controls { gap: 20px; }
  }
`;

const pageShell = (title, headerIcon, headerTitle, headerSubtitle, inner) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${PAGE_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="icon-circle"><span class="icon">${headerIcon}</span></div>
      <h1>${escapeHtml(headerTitle)}</h1>
      <p>${escapeHtml(headerSubtitle)}</p>
    </div>
    ${inner}
  </div>
</body>
</html>`;

const preferencesPage = ({ tenantId, token, emailAddress, interestScores, excluded }) => {
  const excludedSet = new Set(excluded);

  // Inferred topics: score > 0, highest confidence first.
  const inferred = Object.entries(interestScores || {})
    .map(([topic, data]) => ({ topic, score: Number(data?.score) || 0 }))
    .filter(({ topic, score }) => score > 0 && VALID_TOPICS.has(topic))
    .sort((a, b) => b.score - a.score);
  const inferredSet = new Set(inferred.map((i) => i.topic));

  const renderRow = ({ topic, score }) => {
    const isExcluded = excludedSet.has(topic);
    const preferChecked = score > 0 && !isExcluded ? ' checked' : '';
    const excludeChecked = isExcluded ? ' checked' : '';
    const scoreLabel = score > 0
      ? `<span class="topic-score">score ${escapeHtml(formatScore(score))}</span>`
      : '';
    return `
      <div class="topic-row">
        <div class="topic-name">${escapeHtml(getTopicDisplayName(topic))}${scoreLabel}</div>
        <div class="topic-controls">
          <label class="control"><input type="checkbox" name="prefer" value="${escapeHtml(topic)}"${preferChecked}> Interested</label>
          <label class="control exclude"><input type="checkbox" name="exclude" value="${escapeHtml(topic)}"${excludeChecked}> Not interested</label>
        </div>
      </div>`;
  };

  const inferredRows = inferred.length
    ? inferred.map(renderRow).join('')
    : `<p class="section-help">We haven't inferred any interests for you yet. Pick the topics you'd like to hear about below.</p>`;

  // Remaining taxonomy topics we haven't inferred, so subscribers can add them.
  const otherRows = Object.keys(TOPICS)
    .filter((topic) => !inferredSet.has(topic))
    .map((topic) => renderRow({ topic, score: 0 }))
    .join('');

  const inner = `
    <form method="POST" action="/${escapeHtml(tenantId)}/preferences">
      <div class="content">
        <div class="message">
          <strong>Here's what we think you're interested in.</strong><br>
          Update the topics below so we can send you newsletters that actually fit — your corrections always win over what we guessed.
        </div>
        <div class="subscriber">Signed in as ${escapeHtml(maskEmail(emailAddress))}</div>

        <input type="hidden" name="email" value="${escapeHtml(token)}">

        <div class="section-title">Topics we inferred for you</div>
        <div class="section-help">Uncheck anything that's wrong, or mark it "Not interested" so we stop guessing it.</div>
        ${inferredRows}

        <div class="divider"></div>

        <div class="section-title">Add more interests</div>
        <div class="section-help">Tell us about topics we haven't picked up on yet.</div>
        ${otherRows}

        <button type="submit" class="btn">Save my preferences</button>
      </div>
    </form>
    <div class="footer">Your privacy matters — we only use this to tailor what we send.</div>`;

  return pageShell(
    'Your newsletter preferences',
    '&#9881;',
    'Your Preferences',
    escapeHtml(tenantId),
    inner
  );
};

const confirmationPage = ({ tenantId, emailAddress, preferredTopics, excludedTopics }) => {
  const preferredList = preferredTopics.length
    ? `<div class="section-title">Interested in</div>${listTopics(preferredTopics)}`
    : '';
  const excludedList = excludedTopics.length
    ? `<div class="section-title">Not interested in</div>${listTopics(excludedTopics)}`
    : '';
  const nothing = !preferredTopics.length && !excludedTopics.length
    ? `<p class="section-help">No changes were made to your interests.</p>`
    : '';

  const inner = `
    <div class="content">
      <div class="message">
        <strong>Thanks — your preferences are saved.</strong><br>
        We've updated what we send to ${escapeHtml(maskEmail(emailAddress))}.
      </div>
      ${preferredList}
      ${excludedList}
      ${nothing}
    </div>
    <div class="footer">Preferences updated for ${escapeHtml(tenantId)}</div>`;

  return pageShell(
    'Preferences saved',
    '&#10003;',
    'Preferences Saved',
    'Your interests have been updated',
    inner
  );
};

const listTopics = (topics) => {
  const items = topics
    .map((topic) => `<div class="topic-row"><div class="topic-name">${escapeHtml(getTopicDisplayName(topic))}</div></div>`)
    .join('');
  return items;
};

const errorPage = () => pageShell(
  'Preference link problem',
  '&#9888;',
  'Something Went Wrong',
  "We couldn't open your preferences",
  `<div class="content">
      <div class="message">
        <strong>This preferences link looks invalid or expired.</strong><br>
        Please use the "Manage preferences" link from a recent newsletter, or contact support if the problem continues.
      </div>
    </div>
    <div class="footer">No changes were made.</div>`
);

const formatScore = (score) => {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
};

const htmlResponse = (body) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html' },
  body
});
