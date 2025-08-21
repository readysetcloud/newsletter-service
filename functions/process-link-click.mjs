import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { hash } from "./utils/helpers.mjs";
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
      // skip non-JSON lines (e.g., stray logs)
      continue;
    }

    console.log(msg);
    if (!msg || typeof msg !== "object") continue;

    const cid = msg.cid;
    if (!cid || !msg.u) continue;

    const day = isoDay(e.timestamp || Date.now());
    console.log(cid, `link#${hash(msg.u)}`)
    const cmd = new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: cid,
        sk: `link#${hash(msg.u)}`
      }),
      UpdateExpression: "SET #by.#day = if_not_exists(#by.#day, :zero) + :one ADD totalClicks :one",
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

    // Defer sending to control concurrency
    ops.push(async () => {
      try {
        return await ddb.send(cmd);
      } catch (e) {
        console.log(e)
        if (e.name === "ConditionalCheckFailedException") {
          // link was deleted/expired; intentionally skip
          return;
        }
        throw e;
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
  if (jsonStart === -1) {
    return null; // No JSON found
  }
  return message.substring(jsonStart);
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
