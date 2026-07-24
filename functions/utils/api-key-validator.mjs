import crypto from 'crypto';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

/**
 * Handler-side tenant API key validation for endpoints that cannot rely on the
 * Lambda authorizer (e.g. RSS feed URLs consumed by readers that only support
 * query-string credentials). Mirrors the validation in
 * functions/src/auth/lambda-authorizer.rs: decode the self-describing key,
 * load the key record, compare the SHA-256 hash, and check status/expiry.
 * Unlike the authorizer this does not record key usage.
 */

/**
 * Decodes an `ak_<base64url payload>.<secret>` API key without verifying it.
 * @param {string} apiKey
 * @returns {{ tenantId: string, keyId: string } | null}
 */
export const decodeApiKey = (apiKey) => {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('ak_')) {
    return null;
  }

  const parts = apiKey.slice(3).split('.');
  if (parts.length !== 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload.t || !payload.k) {
      return null;
    }
    return { tenantId: payload.t, keyId: payload.k };
  } catch {
    return null;
  }
};

/**
 * Validates a tenant API key against the key record in DynamoDB.
 * @param {string} apiKey - The full API key as presented by the caller
 * @returns {Promise<{ tenantId: string, keyId: string } | null>} Key context when valid, null otherwise
 */
export const validateApiKey = async (apiKey) => {
  const decoded = decodeApiKey(apiKey);
  if (!decoded) {
    return null;
  }

  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: decoded.tenantId,
      sk: `apikey#${decoded.keyId}`
    })
  }));

  if (!result.Item) {
    return null;
  }

  const record = unmarshall(result.Item);
  const expectedHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  if (record.hashedKey !== expectedHash) {
    console.warn('API key hash mismatch - possible tampering attempt');
    return null;
  }

  if (record.status !== 'active') {
    return null;
  }

  if (record.expiresAt && new Date(record.expiresAt) <= new Date()) {
    return null;
  }

  return { tenantId: record.tenantId, keyId: record.keyId };
};
