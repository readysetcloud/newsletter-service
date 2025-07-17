import crypto from 'crypto';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { Octokit } from 'octokit';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

let octokit;
let tenants = {};
const ddb = new DynamoDBClient();
const ivLength = 16;
const algorithm = 'aes-256-gcm';

export const getOctokit = async (tenantId) => {
  if (!octokit) {
    let secrets;
    if (tenantId) {
      const tenant = await getTenant(tenantId);
      secrets = await getParameter(tenant.apiKeyParameter, { decrypt: true, transform: 'json' });
    } else {
      secrets = await getSecret(process.env.SECRET_ID, { transform: 'json' });
    }

    const auth = secrets.github;
    octokit = new Octokit({ auth });
  }

  return octokit;
};

export const getTenant = async (tenantId) => {
  if (tenants.tenantId) {
    return tenants.tenantId;
  } else {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: 'tenant'
      })
    }));

    if (!result.Item) {
      throw new Error(`Tenant '${tenantId}' not found`);
    }

    const data = unmarshall(result.Item);
    tenants.tenantId = data;
    return data;
  }
};

export const formatResponse = (statusCode, body) => {
  return {
    statusCode,
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...process.env.ORIGIN && { 'Access-Control-Allow-Origin': process.env.ORIGIN }
    }
  };
};
export const formatEmptyResponse = () => {
  return {
    statusCode: 204,
    ...process.env.ORIGIN && {
      headers: {
        'Access-Control-Allow-Origin': process.env.ORIGIN
      }
    }
  };
};

const getKey = () => {
  return crypto.createHash('sha256').update(process.env.EMAIL_ENCRYPTION_KEY).digest();
};

export const encrypt = (email) => {
  const key = getKey();
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(email, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');

  // Return iv + encrypted + authTag as one string
  return `${iv.toString('base64')}:${encrypted}:${authTag}`;
};

export const decrypt = (encrypted) => {
  const key = getKey();
  const [ivB64, dataB64, authTagB64] = encrypted.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(dataB64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};
