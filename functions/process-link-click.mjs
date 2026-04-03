import { DynamoDBClient, UpdateItemCommand, PutItemCommand, GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { hash, decrypt } from "./utils/helpers.mjs";
import { detectDevice } from "./utils/detect-device.mjs";
import { lookupCountry } from "./utils/geolocation.mjs";
import { updateSubscriberEngagement } from "./utils/subscriber-engagement.mjs";
import { normalizeUrl } from "./utils/url-normalizer.mjs";
import {
  VALID_TOPICS,
  AUTO_SEGMENT_THRESHOLD,
  PRIMARY_SCORE_INCREMENT,
  SECONDARY_SCORE_INCREMENT,
  MAX_SCORE_PER_CLICK,
  getTopicDisplayName
} from "./utils/topic-taxonomy.mjs";
import { ulid } from "ulid";
import crypto from "crypto";
import zlib from "zlib";

const ddb = new DynamoDBClient();
const CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || "50", 10); // for bursts


export const handler = async (event) => {
  let data;
  try {
    data = decodeLogs(event);
  } catch (e) {
    console.error("Failed to decode CloudWatch Logs payload:", e);
    return { statusCode: 200, body: JSON.stringify({ success: false, processed: 0 }) };
  }

  const events = data.logEvents || [];
  if (!events.length) {
    console.log("No log events to process");
    return { statusCode: 200, body: JSON.stringify({ success: true, processed: 0 }) };
  }

  console.log(`Processing ${events.length} log events from ${data.logGroup}`);

  const ops = [];
  const statsCache = new Map();

  for (const e of events) {
    const jsonPart = extractJsonFromMessage(e.message);
    if (!jsonPart) {
      console.log("No JSON found in message, skipping");
      continue;
    }

    let msg;
    try {
      msg = JSON.parse(jsonPart);
    } catch {
      continue;
    }

    console.log({
      cid: msg.cid || null,
      uHash: msg.u ? hash(msg.u) : null,
      src: msg.src || null,
      ip: msg.ip ? "[redacted]" : null
    });
    if (!msg || typeof msg !== "object") continue;

    const cid = msg.cid;
    if (!cid || !msg.u) continue;

    const day = isoDay(e.timestamp || Date.now());
    console.log(cid, `link#${hash(msg.u)}`)

    const linkUpdateCmd = new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: cid,
        sk: `link#${hash(msg.u)}`
      }),
      UpdateExpression: "SET #by.#day = if_not_exists(#by.#day, :zero) + :one ADD clicks_total :one",
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
      ExpressionAttributeNames: {
        '#by': 'byDay',
        '#day': day
      },
      ExpressionAttributeValues: marshall({
        ':one': 1,
        ':zero': 0
      }),
      ReturnValues: "NONE",
    });

    ops.push(async () => {
      try {
        await ddb.send(linkUpdateCmd);
      } catch (e) {
        if (e.name === "ConditionalCheckFailedException") {
          return;
        }
        throw e;
      }
    });

    ops.push(async () => {
      try {
        await captureClickEvent(msg, e.timestamp, statsCache);
      } catch (err) {
        console.error('Click event capture failed', {
          cid: msg.cid,
          error: err.message
        });
      }
    });

    // Update subscriber engagement fields (cross-issue tracking)
    if (msg.s) {
      const [engTenantId, engIssueNumber] = cid.split('#');
      if (engTenantId && engIssueNumber) {
        ops.push(async () => {
          try {
            const subscriberEmail = decrypt(msg.s);
            await updateSubscriberEngagement(engTenantId, subscriberEmail, parseInt(engIssueNumber, 10));
          } catch (err) {
            console.error('Subscriber engagement update failed', {
              cid,
              error: err.message
            });
          }
        });
      }
    }

    // Interest scoring and auto-segmentation
    if (msg.s) {
      const [tenantId] = cid.split('#');
      ops.push(async () => {
        try {
          const subscriberEmail = decrypt(msg.s);
          await processInterestScoring(tenantId, subscriberEmail, msg.u);
        } catch (err) {
          console.error('Interest scoring failed', { cid, error: err.message });
        }
      });
    }
  }

  const results = await runInBatches(ops, CONCURRENCY);
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length) {
    console.error(`Failed ops: ${failures.length}`, failures.slice(0, 3)); // sample a few
  }

  console.log(`Processed ${results.length - failures.length}/${results.length} updates`);
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: failures.length === 0,
      processed: results.length - failures.length,
      failed: failures.length,
      logGroup: data.logGroup,
      logStream: data.logStream,
    }),
  };
};

const extractJsonFromMessage = (message) => {
  const jsonStart = message.indexOf('{');
  const jsonEnd = message.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return null; // No JSON found
  }
  return message.substring(jsonStart, jsonEnd + 1);
};

const decodeLogs = (event) => {
  const payload = Buffer.from(event.awslogs.data, "base64");
  const json = zlib.gunzipSync(payload).toString("utf8");
  return JSON.parse(json);
};

const isoDay = (tsMs) => {
  return new Date(tsMs).toISOString().slice(0, 10); // YYYY-MM-DD
};

const runInBatches = async (promises, batchSize) => {
  const results = [];
  for (let i = 0; i < promises.length; i += batchSize) {
    const batch = promises.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map((fn) => fn()));
    results.push(...settled);
  }
  return results;
};

const captureClickEvent = async (msg, eventTimestamp, statsCache) => {
  const { cid, u: linkUrl, src, ip, s: subscriberEmailHash, p: linkPosition } = msg;
  const validatedSource = (src === 'email' || src === 'web') ? src : 'web';

  const clickedAt = new Date(eventTimestamp || Date.now());
  const timestamp = clickedAt.toISOString();

  const linkId = crypto.createHash('md5').update(linkUrl).digest('hex').substring(0, 8);
  const eventId = ulid();

  let publishedAt = null;
  if (!statsCache.has(cid)) {
    try {
      const statsResult = await ddb.send(new GetItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({ pk: cid, sk: 'stats' }),
        ProjectionExpression: 'publishedAt'
      }));

      if (statsResult.Item) {
        const stats = unmarshall(statsResult.Item);
        publishedAt = stats.publishedAt || null;
      }
      statsCache.set(cid, publishedAt);
    } catch (err) {
      console.error('Failed to fetch publishedAt', { cid, error: err.message });
      statsCache.set(cid, null);
    }
  } else {
    publishedAt = statsCache.get(cid);
  }

  const timeToClick = publishedAt
    ? Math.floor((clickedAt - new Date(publishedAt)) / 1000)
    : null;

  const finalSubscriberHash = subscriberEmailHash || 'unknown';

  const countryData = ip ? await lookupCountry(ip) : null;

  const device = detectDevice(null);
  const country = countryData?.countryCode || 'unknown';

  const clickEvent = {
    pk: cid,
    sk: `click#${timestamp}#${finalSubscriberHash}#${linkId}#${eventId}`,
    eventType: 'click',
    timestamp,
    subscriberEmailHash: finalSubscriberHash,
    linkUrl,
    linkPosition: linkPosition ?? null,
    trafficSource: validatedSource,
    device,
    country,
    timeToClick,
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
  };

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall(clickEvent)
  }));
};


/**
 * Looks up Link_Metadata for the clicked URL, updates interest scores,
 * and triggers auto-segmentation if threshold is crossed.
 *
 * Errors are logged but never propagated (follows subscriber-engagement.mjs pattern).
 *
 * @param {string} tenantId
 * @param {string} subscriberEmail
 * @param {string} rawUrl - The original clicked URL
 */
export async function processInterestScoring(tenantId, subscriberEmail, rawUrl) {
  try {
    // Normalize the clicked URL
    const normalizedUrl = normalizeUrl(rawUrl);
    if (!normalizedUrl) {
      return;
    }

    // Hash the normalized URL and look up Link_Metadata
    const urlHash = hash(normalizedUrl);
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: 'LINK_META', sk: urlHash }),
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
      tenantId,
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
 * (path does not exist), initializes the interestScores map, then retries exactly once.
 *
 * @param {string} tenantId
 * @param {string} email
 * @param {string} topic - Topic label
 * @param {number} increment - Score increment (1.0 or 0.5)
 * @returns {Promise<{ preScore: number, postScore: number }>}
 */
async function updateInterestScore(tenantId, email, topic, increment) {
  const now = new Date().toISOString();

  const buildNestedUpdateCommand = () => new UpdateItemCommand({
    TableName: process.env.SUBSCRIBERS_TABLE_NAME,
    Key: marshall({ tenantId, email }),
    UpdateExpression: 'SET interestScores.#topic.score = if_not_exists(interestScores.#topic.score, :zero) + :increment, interestScores.#topic.lastScoredAt = :now',
    ExpressionAttributeNames: { '#topic': topic },
    ExpressionAttributeValues: marshall({ ':zero': 0, ':increment': increment, ':now': now }),
    ReturnValues: 'UPDATED_NEW'
  });

  let result;
  try {
    result = await ddb.send(buildNestedUpdateCommand());
  } catch (error) {
    if (error.name === 'ValidationException') {
      // interestScores map does not exist yet — initialize it, then retry once
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.SUBSCRIBERS_TABLE_NAME,
        Key: marshall({ tenantId, email }),
        UpdateExpression: 'SET interestScores = if_not_exists(interestScores, :emptyMap)',
        ExpressionAttributeValues: marshall({ ':emptyMap': {} })
      }));
      result = await ddb.send(buildNestedUpdateCommand());
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
    return existing.segmentId;
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
      // Concurrent creation — retry with GetItem to find existing segment
      const retryResult = await ddb.send(new GetItemCommand({
        TableName: tableName,
        Key: marshall({ tenantId, email: uniquenessKey }),
        ProjectionExpression: 'segmentId'
      }));

      if (retryResult.Item) {
        const retried = unmarshall(retryResult.Item);
        return retried.segmentId;
      }
    }
    throw error;
  }
}
