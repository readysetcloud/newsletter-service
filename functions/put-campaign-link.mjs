import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';
import { formatResponse } from './utils/helpers.mjs';

const ddb = new DynamoDBClient();
const kvs = new CloudFrontKeyValueStoreClient();

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;

export const handler = async (event) => {
  const code = event.pathParameters?.code;
  if (!code || !CODE_PATTERN.test(code)) {
    return formatResponse(400, 'code must be 6 alphanumeric characters');
  }

  if (!event.body) {
    return formatResponse(400, 'Missing request body');
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return formatResponse(400, 'Invalid JSON body');
  }

  const { url, src } = body;
  if (!url || typeof url !== 'string') {
    return formatResponse(400, 'url is required');
  }
  if (!/^https?:\/\//i.test(url)) {
    return formatResponse(400, 'url must be http or https');
  }
  if (url.length > 2048) {
    return formatResponse(400, 'url exceeds 2048 chars');
  }
  if (src !== undefined && src !== null && typeof src !== 'string') {
    return formatResponse(400, 'src must be a string when provided');
  }

  const updatedAt = new Date().toISOString();
  let updated;
  try {
    const result = await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'METADATA' }),
      UpdateExpression: 'SET #url = :url, src = :src, updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#url': 'url' },
      ExpressionAttributeValues: marshall({
        ':url': url,
        ':src': src ?? null,
        ':updatedAt': updatedAt,
      }),
      ReturnValues: 'ALL_NEW',
    }));
    updated = unmarshall(result.Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return formatResponse(404, `Code ${code} not found`);
    }
    throw err;
  }

  const kvsValue = { u: url };
  if (src) kvsValue.src = src;
  await writeKvsEntry(code, kvsValue);

  return formatResponse(200, {
    code,
    short_url: `${process.env.SHORT_LINK_BASE}/${code}`,
    url: updated.url,
    src: updated.src ?? null,
    campaign_id: updated.campaignId ?? null,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt,
    expires_at: updated.expiresAt,
  });
};

async function writeKvsEntry(code, value) {
  const describe = await kvs.send(new DescribeKeyValueStoreCommand({ KvsARN: process.env.KVS_ARN }));
  await kvs.send(new PutKeyCommand({
    KvsARN: process.env.KVS_ARN,
    Key: code,
    Value: JSON.stringify(value),
    IfMatch: describe.ETag,
  }));
}
