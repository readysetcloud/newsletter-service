import { DynamoDBClient, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { ulid } from 'ulid';
import zlib from 'zlib';

const ddb = new DynamoDBClient();
const TABLE = process.env.TABLE_NAME;
const CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || '25', 10);
const CLICK_TTL_SECONDS = 90 * 24 * 60 * 60;

export const handler = async (event) => {
  let data;
  try {
    data = decodeLogs(event);
  } catch (err) {
    console.error('Failed to decode CloudWatch Logs payload', err);
    return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
  }

  const events = data.logEvents || [];
  if (!events.length) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
  }

  const ops = [];
  for (const e of events) {
    const json = extractJson(e.message);
    if (!json) continue;

    let msg;
    try {
      msg = JSON.parse(json);
    } catch {
      continue;
    }

    if (!msg || typeof msg !== 'object') continue;
    if (!msg.code || typeof msg.code !== 'string') continue;

    const occurredAt = new Date(e.timestamp || Date.now()).toISOString();
    const day = occurredAt.slice(0, 10);
    const src = msg.src || 'web';

    ops.push(() => recordClickEvent({ code: msg.code, occurredAt, src, raw: msg }));
    ops.push(() => incrementAggregate({ code: msg.code, day, src, occurredAt }));
  }

  const results = await runInBatches(ops, CONCURRENCY);
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length) {
    console.error(`Failed ops: ${failures.length}`, failures.slice(0, 3));
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      processed: results.length - failures.length,
      failed: failures.length,
    }),
  };
};

async function recordClickEvent({ code, occurredAt, src, raw }) {
  await ddb.send(new PutItemCommand({
    TableName: TABLE,
    Item: marshall({
      pk: `CAMPAIGN_LINK_CODE#${code}`,
      sk: `CLICK#${occurredAt}#${ulid()}`,
      entity: 'CampaignLinkClick',
      code,
      occurredAt,
      src,
      destinationUrl: raw.u || null,
      subscriberHash: raw.s || null,
      ttl: Math.floor(Date.now() / 1000) + CLICK_TTL_SECONDS,
    }, { removeUndefinedValues: true }),
  }));
}

async function incrementAggregate({ code, day, src, occurredAt }) {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'AGGREGATE' }),
      UpdateExpression: [
        'SET code = if_not_exists(code, :code)',
        'entity = if_not_exists(entity, :entity)',
        'byDay.#day = if_not_exists(byDay.#day, :zero) + :one',
        'bySrc.#src = if_not_exists(bySrc.#src, :zero) + :one',
        'lastClickAt = :ts',
        'firstClickAt = if_not_exists(firstClickAt, :ts)',
      ].join(', ') + ' ADD totalClicks :one',
      ExpressionAttributeNames: { '#day': day, '#src': src },
      ExpressionAttributeValues: marshall({
        ':code': code,
        ':entity': 'CampaignLinkAggregate',
        ':zero': 0,
        ':one': 1,
        ':ts': occurredAt,
      }),
    }));
  } catch (err) {
    if (err.name === 'ValidationException') {
      await ddb.send(new UpdateItemCommand({
        TableName: TABLE,
        Key: marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'AGGREGATE' }),
        UpdateExpression: 'SET byDay = if_not_exists(byDay, :empty), bySrc = if_not_exists(bySrc, :empty)',
        ExpressionAttributeValues: marshall({ ':empty': {} }),
      }));
      return incrementAggregate({ code, day, src, occurredAt });
    }
    throw err;
  }
}

function extractJson(message) {
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return message.substring(start, end + 1);
}

function decodeLogs(event) {
  const payload = Buffer.from(event.awslogs.data, 'base64');
  const json = zlib.gunzipSync(payload).toString('utf8');
  return JSON.parse(json);
}

async function runInBatches(ops, batchSize) {
  const results = [];
  for (let i = 0; i < ops.length; i += batchSize) {
    const batch = ops.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map((fn) => fn()));
    results.push(...settled);
  }
  return results;
}
