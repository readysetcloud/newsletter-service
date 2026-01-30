import { DynamoDBClient, UpdateItemCommand, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { hash } from "./utils/helpers.mjs";
import { detectDevice } from "./utils/detect-device.mjs";
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
  const { cid, u: linkUrl, src, ip, s: subscriberEmailHash } = msg;

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

  const device = detectDevice(null);
  const country = 'unknown';

  const clickEvent = {
    pk: cid,
    sk: `click#${timestamp}#${finalSubscriberHash}#${linkId}#${eventId}`,
    eventType: 'click',
    timestamp,
    subscriberEmailHash: finalSubscriberHash,
    linkUrl,
    linkPosition: null,
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
