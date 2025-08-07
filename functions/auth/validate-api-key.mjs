import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { decodeApiKey, hashApiKey } from './decode-api-key.mjs';

const ddb = new DynamoDBClient();

export const validateApiKey = async (apiKey) => {
  try {
    const decoded = decodeApiKey(apiKey);
    if (!decoded) {
      return null;
    }

    const response = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: decoded.tenantId,
        sk: `apikey#${decoded.keyId}`
      })
    }));

    if (!response.Item) {
      return null;
    }

    const apiKeyRecord = unmarshall(response.Item);

    const expectedHash = hashApiKey(apiKey);
    if (apiKeyRecord.hashedKey !== expectedHash) {
      console.warn('API key hash mismatch - possible tampering attempt');
      return null;
    }

    if (apiKeyRecord.status !== 'active') {
      console.warn(`API key validation failed: status is '${apiKeyRecord.status}', expected 'active'`);
      return null;
    }
    if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) <= new Date()) {
      return null;
    }

    await updateApiKeyUsage(apiKeyRecord.pk, apiKeyRecord.sk);
    return {
      tenantId: apiKeyRecord.tenantId,
      keyId: apiKeyRecord.keyId,
      createdBy: apiKeyRecord.createdBy,
      authType: 'api_key'
    };

  } catch (error) {
    console.error('API key validation error:', error);
    return null;
  }
};

const updateApiKeyUsage = async (pk, sk) => {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk, sk }),
      UpdateExpression: 'SET lastUsed = :lastUsed, usageCount = if_not_exists(usageCount, :zero) + :one',
      ExpressionAttributeValues: marshall({
        ':lastUsed': new Date().toISOString(),
        ':zero': 0,
        ':one': 1
      })
    }));
  } catch (error) {
    console.error('Failed to update API key usage:', error);
  }
};
