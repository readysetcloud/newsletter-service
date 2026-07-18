import {
  DynamoDBClient,
  UpdateItemCommand,
  PutItemCommand,
  GetItemCommand,
  TransactWriteItemsCommand
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { hash } from './helpers.mjs';
import {
  VALID_TOPICS,
  AUTO_SEGMENT_THRESHOLD,
  PRIMARY_SCORE_INCREMENT,
  SECONDARY_SCORE_INCREMENT,
  MAX_SCORE_PER_CLICK,
  getTopicDisplayName
} from './topic-taxonomy.mjs';
import { ulid } from 'ulid';

/**
 * Per-subscriber interest scoring and auto-segmentation.
 *
 * This logic is shared by the two click surfaces that know a subscriber's
 * identity:
 *   - functions/handle-email-status.mjs — SES native email-click events, which
 *     carry the recipient address. This is where real subscribers get scored.
 *   - functions/process-link-click.mjs — the CloudFront/web-version redirect
 *     path, which only carries an identity token (`s`) on non-anonymous links.
 *
 * It lives in its own module (rather than inside a specific handler) so both
 * entry points can import it without dragging in each other's transitive
 * dependencies.
 */

const ddb = new DynamoDBClient();

/**
 * Looks up the issue's link record (enriched at staging time with an LLM
 * topic classification) for the clicked URL, updates interest scores, and
 * triggers auto-segmentation if the threshold is crossed.
 *
 * Errors are logged but never propagated (follows subscriber-engagement.mjs pattern).
 *
 * @param {string} cid - The issue partition key, `${tenantId}#${issueNumber}`
 * @param {string} subscriberEmail
 * @param {string} rawUrl - The original clicked URL
 */
export async function processInterestScoring(cid, subscriberEmail, rawUrl) {
  try {
    const [tenantId] = cid.split('#');

    // The clicked URL hashes to the same link record key written at staging time.
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: cid, sk: `link#${hash(rawUrl)}` }),
      ProjectionExpression: 'primaryTopic, secondaryTopics'
    }));

    if (!result.Item) {
      return;
    }

    const metadata = unmarshall(result.Item);
    const { primaryTopic, secondaryTopics } = metadata;

    // Build scored topics: primary +1.0, first secondary +0.5, cap at 1.5
    const scoredTopics = [];
    let totalScore = 0;

    if (primaryTopic && VALID_TOPICS.has(primaryTopic)) {
      scoredTopics.push({ topic: primaryTopic, increment: PRIMARY_SCORE_INCREMENT });
      totalScore += PRIMARY_SCORE_INCREMENT;
    }

    if (Array.isArray(secondaryTopics) && secondaryTopics.length > 0) {
      const firstSecondary = secondaryTopics[0];
      if (firstSecondary && VALID_TOPICS.has(firstSecondary) && totalScore + SECONDARY_SCORE_INCREMENT <= MAX_SCORE_PER_CLICK) {
        scoredTopics.push({ topic: firstSecondary, increment: SECONDARY_SCORE_INCREMENT });
        totalScore += SECONDARY_SCORE_INCREMENT;
      }
    }

    // Apply score increments and check threshold crossing
    for (const { topic, increment } of scoredTopics) {
      const { preScore, postScore } = await updateInterestScore(tenantId, subscriberEmail, topic, increment);

      // Check threshold crossing: pre < threshold AND post >= threshold
      if (preScore < AUTO_SEGMENT_THRESHOLD && postScore >= AUTO_SEGMENT_THRESHOLD) {
        await handleAutoSegmentation(tenantId, subscriberEmail, topic);
      }
    }
  } catch (error) {
    console.error('Interest scoring failed', {
      cid,
      subscriberEmail,
      rawUrl,
      error: error.message
    });
  }
}

/**
 * Atomically increments a topic's interest score on the subscriber record.
 * Uses DynamoDB SET with if_not_exists() + :increment and ReturnValues: UPDATED_NEW.
 * (DynamoDB ADD does not work on nested document paths — SET is the correct pattern.)
 *
 * Handles nested map initialization: attempts the nested SET, catches ValidationException
 * (path does not exist), initializes both the interestScores map AND the per-topic entry,
 * then retries exactly once.
 *
 * @param {string} tenantId
 * @param {string} email
 * @param {string} topic - Topic label
 * @param {number} increment - Score increment (1.0 or 0.5)
 * @returns {Promise<{ preScore: number, postScore: number }>}
 */
async function updateInterestScore(tenantId, email, topic, increment) {
  const now = new Date().toISOString();

  // The subscriber can explicitly correct our inferred profile via the
  // preference center. A topic they marked "not interested" lands in the
  // `excludedTopics` set, and a zero-party correction must beat click signal:
  // this condition makes every automatic score increment a no-op for an
  // excluded topic. `attribute_not_exists(excludedTopics)` covers the common
  // case (no exclusions recorded); `NOT contains(...)` gates the rest.
  const EXCLUSION_GUARD = 'attribute_not_exists(excludedTopics) OR NOT contains(excludedTopics, :topic)';

  const buildNestedUpdateCommand = () => new UpdateItemCommand({
    TableName: process.env.SUBSCRIBERS_TABLE_NAME,
    Key: marshall({ tenantId, email }),
    UpdateExpression: 'SET interestScores.#topic.score = if_not_exists(interestScores.#topic.score, :zero) + :increment, interestScores.#topic.lastScoredAt = :now',
    ConditionExpression: EXCLUSION_GUARD,
    ExpressionAttributeNames: { '#topic': topic },
    ExpressionAttributeValues: marshall({ ':zero': 0, ':increment': increment, ':now': now, ':topic': topic }),
    ReturnValues: 'UPDATED_NEW'
  });

  // Sentinel returned when scoring is skipped for an excluded topic. The caller
  // gates auto-segmentation on `preScore < THRESHOLD && postScore >= THRESHOLD`;
  // nulls make the second half false, so segmentation never fires.
  const SKIPPED = { preScore: null, postScore: null };

  let result;
  try {
    result = await ddb.send(buildNestedUpdateCommand());
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Topic is on the subscriber's exclusion list — respect the correction.
      return SKIPPED;
    }
    if (error.name === 'ValidationException') {
      // The nested path interestScores.<topic> does not exist yet. DynamoDB
      // cannot set interestScores.<topic>.score unless BOTH interestScores and
      // interestScores.<topic> already exist as maps — initializing only the
      // top-level map (as a previous version did) leaves the retry failing with
      // the same ValidationException, so no score ever lands. Initialize both
      // levels (idempotently, so concurrent clicks don't clobber each other),
      // then retry the atomic increment once.

      // Step 1: ensure the top-level interestScores map exists.
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.SUBSCRIBERS_TABLE_NAME,
        Key: marshall({ tenantId, email }),
        UpdateExpression: 'SET interestScores = if_not_exists(interestScores, :emptyMap)',
        ExpressionAttributeValues: marshall({ ':emptyMap': {} })
      }));

      // Step 2: ensure the per-topic entry exists, zeroed. if_not_exists keeps a
      // concurrently-created entry (with its accumulated score) intact. The same
      // exclusion guard applies here so an excluded topic's entry is never even
      // re-created (an exclusion REMOVEs it, leaving the nested path missing).
      try {
        await ddb.send(new UpdateItemCommand({
          TableName: process.env.SUBSCRIBERS_TABLE_NAME,
          Key: marshall({ tenantId, email }),
          UpdateExpression: 'SET interestScores.#topic = if_not_exists(interestScores.#topic, :zeroEntry)',
          ConditionExpression: EXCLUSION_GUARD,
          ExpressionAttributeNames: { '#topic': topic },
          ExpressionAttributeValues: marshall({ ':zeroEntry': { score: 0, lastScoredAt: now }, ':topic': topic })
        }));
      } catch (initError) {
        if (initError.name === 'ConditionalCheckFailedException') {
          return SKIPPED;
        }
        throw initError;
      }

      // Step 3: retry the atomic increment now that both levels exist.
      try {
        result = await ddb.send(buildNestedUpdateCommand());
      } catch (retryError) {
        if (retryError.name === 'ConditionalCheckFailedException') {
          return SKIPPED;
        }
        throw retryError;
      }
    } else {
      throw error;
    }
  }

  const updated = unmarshall(result.Attributes);
  const postScore = updated.interestScores?.[topic]?.score ?? increment;
  const preScore = postScore - increment;

  return { preScore, postScore };
}

/**
 * Checks if the score crossed the threshold and handles auto-segmentation:
 * 1. Looks up or creates the Interest_Segment for the topic
 * 2. Adds the subscriber as a member (idempotent)
 *
 * @param {string} tenantId
 * @param {string} email
 * @param {string} topic - Topic label
 */
async function handleAutoSegmentation(tenantId, email, topic) {
  const segmentId = await findOrCreateInterestSegment(tenantId, topic);
  if (!segmentId) {
    // Colliding manual segment exists — skip auto-segmentation for this topic
    return;
  }
  await addSubscriberToSegment(tenantId, email, segmentId);
}

/**
 * Idempotently adds a subscriber as a member of an interest segment and keeps
 * the segment's memberCount in sync. Writes the SEGMENT#<id>#MEMBER#<email> row
 * with a conditional Put (skip if already a member) and increments memberCount
 * only when a new row is actually created.
 *
 * Exported so the subscriber-facing preference center can reuse the exact same
 * membership semantics as automatic click-based segmentation.
 *
 * @param {string} tenantId
 * @param {string} email
 * @param {string} segmentId
 */
export async function addSubscriberToSegment(tenantId, email, segmentId) {
  const tableName = process.env.SUBSCRIBERS_TABLE_NAME;

  try {
    // Idempotent member addition — skip if already a member
    await ddb.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall({
        tenantId,
        email: `SEGMENT#${segmentId}#MEMBER#${email}`,
        subscriberEmail: email,
        segmentId,
        addedAt: new Date().toISOString(),
        memberEmail: email
      }),
      ConditionExpression: 'attribute_not_exists(email)'
    }));

    // New member added — increment memberCount on the segment record
    await ddb.send(new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ tenantId, email: `SEGMENT#${segmentId}` }),
      UpdateExpression: 'ADD memberCount :one',
      ExpressionAttributeValues: marshall({ ':one': 1 })
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Already a member — skip silently
      return;
    }
    throw error;
  }
}

/**
 * Finds or creates an Interest_Segment for a topic.
 * Uses the existing segment data model with autoManaged: true.
 *
 * Uniqueness key uses normalized lowercase topic label: SEGMENT_NAME#auto: {topic_label}
 * Display name uses topic display name: "Auto: {displayName}"
 *
 * @param {string} tenantId
 * @param {string} topic - Topic label (lowercase)
 * @returns {Promise<string>} segmentId
 */
export async function findOrCreateInterestSegment(tenantId, topic) {
  const uniquenessKey = `SEGMENT_NAME#auto: ${topic}`;
  const tableName = process.env.SUBSCRIBERS_TABLE_NAME;

  // Step 1: Check if segment already exists via uniqueness record
  const existingResult = await ddb.send(new GetItemCommand({
    TableName: tableName,
    Key: marshall({ tenantId, email: uniquenessKey }),
    ProjectionExpression: 'segmentId'
  }));

  if (existingResult.Item) {
    const existing = unmarshall(existingResult.Item);
    const existingSegmentId = existing.segmentId;

    // Verify the target segment is actually auto-managed.
    // A user-created segment can collide on the uniqueness key
    // (e.g. manually naming a segment "Auto: AI"), so we must
    // confirm autoManaged === true before reusing it.
    const segmentResult = await ddb.send(new GetItemCommand({
      TableName: tableName,
      Key: marshall({ tenantId, email: `SEGMENT#${existingSegmentId}` }),
      ProjectionExpression: 'autoManaged'
    }));

    if (segmentResult.Item) {
      const segmentRecord = unmarshall(segmentResult.Item);
      if (segmentRecord.autoManaged !== true) {
        // Segment exists but is manually managed — do not hijack it
        console.warn('Skipping auto-segmentation: colliding segment is not auto-managed', {
          tenantId, topic, segmentId: existingSegmentId
        });
        return null;
      }
    }

    return existingSegmentId;
  }

  // Step 2: Segment doesn't exist — create via TransactWriteItems
  const segmentId = ulid();
  const displayName = getTopicDisplayName(topic);
  const now = new Date().toISOString();

  try {
    await ddb.send(new TransactWriteItemsCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: marshall({
              tenantId,
              email: uniquenessKey,
              segmentId
            }),
            ConditionExpression: 'attribute_not_exists(email)'
          }
        },
        {
          Put: {
            TableName: tableName,
            Item: marshall({
              tenantId,
              email: `SEGMENT#${segmentId}`,
              segmentId,
              name: `Auto: ${displayName}`,
              description: `Automatically created segment for subscribers interested in ${displayName}`,
              memberCount: 0,
              autoManaged: true,
              createdAt: now
            })
          }
        }
      ]
    }));

    return segmentId;
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      // Concurrent creation — retry with strongly consistent read.
      // Default GetItem is eventually consistent and can miss a segment
      // created milliseconds earlier, so ConsistentRead is required here.
      const retryResult = await ddb.send(new GetItemCommand({
        TableName: tableName,
        Key: marshall({ tenantId, email: uniquenessKey }),
        ProjectionExpression: 'segmentId',
        ConsistentRead: true
      }));

      if (retryResult.Item) {
        const retried = unmarshall(retryResult.Item);
        return retried.segmentId;
      }
    }
    throw error;
  }
}
