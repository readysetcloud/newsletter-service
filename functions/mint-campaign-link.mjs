import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';
import crypto from 'crypto';
import { formatResponse } from './utils/helpers.mjs';

const ddb = new DynamoDBClient();
const kvs = new CloudFrontKeyValueStoreClient();

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 6;
const MAX_COLLISION_RETRIES = 5;
const DEFAULT_EXPIRES_IN_DAYS = 730;
const MAX_EXPIRES_IN_DAYS = 1825;

export const handler = async (event) => {
  if (!event.body) {
    return formatResponse(400, 'Missing request body');
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return formatResponse(400, 'Invalid JSON body');
  }

  const { url, cid, src, expiresInDays } = body;

  if (!url || typeof url !== 'string') {
    return formatResponse(400, 'url is required');
  }
  if (!/^https?:\/\//i.test(url)) {
    return formatResponse(400, 'url must be http or https');
  }
  if (url.length > 2048) {
    return formatResponse(400, 'url exceeds 2048 chars');
  }
  if (cid !== undefined && typeof cid !== 'string') {
    return formatResponse(400, 'cid must be a string when provided');
  }
  if (src !== undefined && typeof src !== 'string') {
    return formatResponse(400, 'src must be a string when provided');
  }
  if (expiresInDays !== undefined) {
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_EXPIRES_IN_DAYS) {
      return formatResponse(400, `expiresInDays must be an integer between 1 and ${MAX_EXPIRES_IN_DAYS}`);
    }
  }

  const ttlDays = expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 86400 * 1000).toISOString();

  const code = await allocateUniqueCode(now.toISOString(), expiresAt);
  if (!code) {
    return formatResponse(503, 'Could not allocate a unique code');
  }

  const kvsValue = { u: url };
  if (cid) kvsValue.cid = cid;
  if (src) kvsValue.src = src;

  await writeKvsEntry(code, kvsValue);

  return formatResponse(200, {
    code,
    short_url: `${process.env.SHORT_LINK_BASE}/${code}`,
    expires_at: expiresAt,
  });
};

async function allocateUniqueCode(createdAt, expiresAt) {
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const code = generateCode();
    try {
      await ddb.send(new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall({
          pk: `CAMPAIGN_LINK_CODE#${code}`,
          sk: `CAMPAIGN_LINK_CODE#${code}`,
          GSI1PK: 'CAMPAIGN_LINK_CODE_EXPIRY',
          GSI1SK: expiresAt,
          code,
          createdAt,
          expiresAt,
        }),
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return code;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') continue;
      throw err;
    }
  }
  return null;
}

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

async function writeKvsEntry(code, value) {
  const describe = await kvs.send(new DescribeKeyValueStoreCommand({ KvsARN: process.env.KVS_ARN }));
  await kvs.send(new PutKeyCommand({
    KvsARN: process.env.KVS_ARN,
    Key: code,
    Value: JSON.stringify(value),
    IfMatch: describe.ETag,
  }));
}
