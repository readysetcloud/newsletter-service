/**
 * Rate Limiter Utility
 *
 * DynamoDB-backed fixed-window rate limiter for the bot signup protection pipeline.
 * Uses atomic UpdateItem with ADD for concurrent-safe counter increments.
 * Counter items auto-expire via DynamoDB TTL.
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = new DynamoDBClient();

/**
 * Increment the rate limit counter for an IP+tenant pair.
 * Uses DynamoDB UpdateItem with ADD to atomically increment.
 * Creates the item on first request with TTL = now + windowSeconds.
 *
 * For unknown IPs (sourceIp === "unknown"), uses a shared bucket with
 * threshold from UNKNOWN_IP_RATE_LIMIT_THRESHOLD env var (default 5).
 *
 * @param {string} tenantId
 * @param {string} sourceIp - "unknown" bucket for unknown IPs
 * @param {object} policy - { rateLimitThreshold, rateLimitWindowSeconds }
 * @returns {Promise<{ count: number, limited: boolean, retryAfterSeconds: number|null }>}
 */
export async function checkRateLimit(tenantId, sourceIp, policy) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttlValue = nowSeconds + policy.rateLimitWindowSeconds;

  const result = await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: {
      pk: { S: `ratelimit#${tenantId}#${sourceIp}` },
      sk: { S: 'counter' }
    },
    UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :inc, #ttl = if_not_exists(#ttl, :ttl)',
    ConditionExpression: 'attribute_not_exists(#ttl) OR #ttl > :now',
    ExpressionAttributeNames: {
      '#count': 'count',
      '#ttl': 'ttl'
    },
    ExpressionAttributeValues: {
      ':inc': { N: '1' },
      ':zero': { N: '0' },
      ':ttl': { N: String(ttlValue) },
      ':now': { N: String(nowSeconds) }
    },
    ReturnValues: 'ALL_NEW'
  })).catch(async (err) => {
    if (err.name === 'ConditionalCheckFailedException') {
      // TTL expired but item not yet removed — reset the window
      return ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: {
          pk: { S: `ratelimit#${tenantId}#${sourceIp}` },
          sk: { S: 'counter' }
        },
        UpdateExpression: 'SET #count = :inc, #ttl = :ttl',
        ExpressionAttributeNames: {
          '#count': 'count',
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':inc': { N: '1' },
          ':ttl': { N: String(ttlValue) }
        },
        ReturnValues: 'ALL_NEW'
      }));
    }
    throw err;
  });

  const count = parseInt(result.Attributes.count.N, 10);
  const itemTtl = parseInt(result.Attributes.ttl.N, 10);

  const threshold = sourceIp === 'unknown'
    ? parseInt(process.env.UNKNOWN_IP_RATE_LIMIT_THRESHOLD || '5', 10)
    : policy.rateLimitThreshold;

  const limited = count > threshold;
  const retryAfterSeconds = limited ? Math.max(0, itemTtl - Math.floor(Date.now() / 1000)) : null;

  return { count, limited, retryAfterSeconds };
}
