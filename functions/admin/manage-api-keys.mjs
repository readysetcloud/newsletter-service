import { DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand, DeleteItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomBytes } from 'crypto';
import { hashApiKey } from '../auth/decode-api-key.mjs';
import { formatResponse, formatEmptyResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { userId, tenantId } = userContext;

    const method = event.httpMethod;
    const pathParameters = event.pathParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};

    // Route to appropriate handler based on HTTP method
    switch (method) {
      case 'POST':
        return await createApiKey(userId, tenantId, body);
      case 'GET':
        if (pathParameters.keyId) {
          return await getApiKey(tenantId, pathParameters.keyId);
        } else {
          return await listApiKeys(tenantId);
        }
      case 'DELETE':
        const queryParams = event.queryStringParameters || {};
        const shouldRevoke = queryParams.revoke === 'true';

        if (shouldRevoke) {
          return await revokeApiKey(tenantId, pathParameters.keyId);
        } else {
          return await deleteApiKey(tenantId, pathParameters.keyId);
        }
      default:
        return formatResponse(405, 'Method not allowed');
    }

  } catch (error) {
    console.error('API key management error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.message.startsWith('Validation error:')) {
      return formatResponse(400, error.message);
    }

    return formatResponse(500, 'Something went wrong');
  }
};
const createApiKey = async (userId, tenantId, body) => {
  const { name, description, expiresAt } = body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('"name" is required and must be a non-empty string');
  }

  if (name.length > 100) {
    throw new Error('"name" must be 100 characters or less');
  }

  if (description && (typeof description !== 'string' || description.length > 500)) {
    throw new Error('"description" must be a string with max 500 characters');
  }


  const existingKeysResponse = await ddb.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    FilterExpression: '#name = :name',
    ExpressionAttributeNames: {
      '#name': 'name'
    },
    ExpressionAttributeValues: marshall({
      ':pk': tenantId,
      ':sk': 'apikey#',
      ':name': name.trim()
    })
  }));

  if (existingKeysResponse.Items && existingKeysResponse.Items.length > 0) {
    throw new Error(`Validation error: API key with name "${name.trim()}" already exists for this tenant`);
  }

  let expirationTimestamp = null;
  if (expiresAt) {
    const expDate = new Date(expiresAt);
    if (isNaN(expDate.getTime())) {
      throw new Error('"expiresAt" must be a valid ISO date string');
    }
    if (expDate <= new Date()) {
      throw new Error('"expiresAt" must be in the future');
    }
    expirationTimestamp = Math.floor(expDate.getTime() / 1000);
  }

  const keyId = generateKeyId();
  const keyValue = generateApiKey(tenantId, keyId);
  const hashedKey = hashApiKey(keyValue);

  const apiKeyRecord = {
    pk: tenantId,
    sk: `apikey#${keyId}`,
    keyId,
    name: name.trim(),
    description: description?.trim() || null,
    scopes: body.scopes || ['default'],
    hashedKey,
    tenantId,
    createdBy: userId,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    usageCount: 0,
    status: 'active',
    ...(expirationTimestamp && {
      expiresAt: new Date(expirationTimestamp * 1000).toISOString(),
      ttl: expirationTimestamp
    })
  };

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall(apiKeyRecord),
    ConditionExpression: 'attribute_not_exists(sk)'
  }));

  return formatResponse(201, { id: keyId, value: keyValue });
};

const listApiKeys = async (tenantId) => {
  if (!tenantId) {
    throw new Error('Validation error: tenantId is required for API key operations');
  }

  const response = await ddb.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: marshall({
      ':pk': tenantId,
      ':sk': 'apikey#'
    })
  }));

  const apiKeys = response.Items?.map(item => {
    const key = unmarshall(item);
    return {
      keyId: key.keyId,
      name: key.name,
      description: key.description,
      keyValue: '***hidden***',
      tenantId: key.tenantId,
      createdAt: key.createdAt,
      lastUsed: key.lastUsed,
      usageCount: key.usageCount || 0,
      expiresAt: key.expiresAt || null,
      status: key.status,
      ...(key.revokedAt && { revokedAt: key.revokedAt })
    };
  }) || [];

  return formatResponse(200, {
    apiKeys,
    count: apiKeys.length
  });
};

const getApiKey = async (tenantId, keyId) => {
  if (!keyId) {
    throw new Error('"keyId" is required');
  }

  if (!tenantId) {
    throw new Error('"tenantId" is required for API key operations');
  }

  const response = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: `apikey#${keyId}`
    })
  }));

  if (!response.Item) {
    return formatResponse(404, 'API key not found');
  }

  const key = unmarshall(response.Item);

  return formatResponse(200, {
    apiKey: {
      keyId: key.keyId,
      name: key.name,
      description: key.description,
      keyValue: '***hidden***',
      tenantId: key.tenantId,
      createdBy: key.createdBy,
      createdAt: key.createdAt,
      lastUsed: key.lastUsed,
      usageCount: key.usageCount || 0,
      expiresAt: key.expiresAt || null,
      status: key.status,
      ...(key.revokedAt && { revokedAt: key.revokedAt })
    }
  });
};

const revokeApiKey = async (tenantId, keyId) => {
  if (!keyId) {
    throw new Error('Validation error: "keyId" is required');
  }

  if (!tenantId) {
    throw new Error('Validation error: "tenantId" is required for API key operations');
  }

  // Check if key exists first
  const existsResponse = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: `apikey#${keyId}`
    })
  }));

  if (!existsResponse.Item) {
    return formatResponse(404, 'API key not found');
  }

  const apiKeyRecord = unmarshall(existsResponse.Item);

  if (apiKeyRecord.status === 'revoked') {
    return formatResponse(400, 'API key is already revoked');
  }

  const revokedAt = new Date().toISOString();
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: `apikey#${keyId}`
    }),
    UpdateExpression: 'SET #status = :status, revokedAt = :revokedAt',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: marshall({
      ':status': 'revoked',
      ':revokedAt': revokedAt
    })
  }));

  return formatResponse(200, {
    message: 'API key revoked successfully',
    keyId,
    status: 'revoked',
    revokedAt
  });
};

const deleteApiKey = async (tenantId, keyId) => {
  if (!keyId) {
    throw new Error('"keyId" is required');
  }

  if (!tenantId) {
    throw new Error('"tenantId" is required for API key operations');
  }

  // Check if key exists first
  const existsResponse = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: `apikey#${keyId}`
    })
  }));

  if (!existsResponse.Item) {
    return formatResponse(404, 'API key not found');
  }

  await ddb.send(new DeleteItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: `apikey#${keyId}`
    })
  }));

  return formatEmptyResponse(204);
};

const generateApiKey = (tenantId, keyId) => {
  const payload = {
    t: tenantId,
    k: keyId,
    ts: Date.now()
  };

  const secret = randomBytes(24);

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const encodedSecret = secret.toString('base64url');

  return `ak_${encodedPayload}.${encodedSecret}`;
};

const generateKeyId = () => {
  const bytes = randomBytes(16);
  return bytes.toString('hex');
};


