import crypto from 'crypto';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { Octokit } from 'octokit';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

let octokit;
// A Map, not an object: tenant ids are external input, and on a plain object an
// id like `constructor` or `toString` hits an inherited property and returns a
// built-in instead of ever reaching DynamoDB.
const tenants = new Map();
const ddb = new DynamoDBClient();
const ivLength = 16;
const algorithm = 'aes-256-gcm';
const TPS_LIMIT = 5;
const MAX_RETRIES = 3;

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

/**
 * Loads a tenant record, memoized for the life of the execution environment.
 *
 * The cache is keyed by `tenantId`, which it previously was not: it wrote every
 * tenant to a property literally named `tenantId`, so the first tenant a warm
 * container saw was returned for every tenant after it. That is a cross-tenant
 * leak, not just a stale read — callers use this for the address outbound mail
 * is sent to and for `apiKeyParameter`, the tenant's own GitHub credential.
 *
 * A cache miss still throws for an unknown tenant, so a miss is never silently
 * a success.
 */
export const getTenant = async (tenantId) => {
  if (tenants.has(tenantId)) {
    return tenants.get(tenantId);
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
    tenants.set(tenantId, data);
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
/**
 * Helper to format authorization error responses
 */
export const formatAuthError = (message = 'Unauthorized') => {
  return {
    statusCode: 403,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.ORIGIN || '*'
    },
    body: JSON.stringify({ message })
  };
};

const getKey = () => {
  return crypto.createHash('sha256').update(process.env.EMAIL_ENCRYPTION_KEY).digest();
};

export const hash = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
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

/**
 * Undo the one transformation a query string makes to a base64 token.
 *
 * `encrypt` emits standard base64, whose alphabet includes `+`. Every producer
 * of these tokens puts one in a URL's query string, and `+` in a query value
 * decodes to a space — so `?email=<token>` arrives at the handler with each `+`
 * turned into ` `. Node's base64 decoder then *skips* the space rather than
 * failing on it, which shifts every subsequent byte and makes the GCM auth tag
 * reject the payload. Roughly seven in ten tokens contain at least one `+`, so
 * that is most unsubscribe links, not an edge case.
 *
 * Producers now percent-encode the token, but the links already sitting in
 * delivered inboxes cannot be recalled and will keep arriving corrupted for as
 * long as those emails exist. Repairing it on the way in is what actually
 * honours them. A space is never valid base64, so there is nothing else it
 * could have been.
 */
const restoreQueryEncodedBase64 = (token) => token.replace(/ /g, '+');

export const decrypt = (encrypted) => {
  try {
    if (!encrypted || typeof encrypted !== 'string') {
      throw new Error('Invalid encrypted data: must be a non-empty string');
    }

    const parts = restoreQueryEncodedBase64(encrypted).split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format: expected 3 parts separated by colons');
    }

    const [ivB64, dataB64, authTagB64] = parts;

    if (!ivB64 || !dataB64 || !authTagB64) {
      throw new Error('Invalid encrypted data: missing required parts');
    }

    const key = getKey();
    let iv, authTag;

    try {
      iv = Buffer.from(ivB64, 'base64');
      authTag = Buffer.from(authTagB64, 'base64');
    } catch (bufferError) {
      throw new Error('Invalid encrypted data: malformed base64 encoding');
    }

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted;
    try {
      decrypted = decipher.update(dataB64, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
    } catch (decipherError) {
      throw new Error('Failed to decrypt data: invalid key, corrupted data, or authentication failure');
    }

    return decrypted;
  } catch (error) {
    // Re-throw with more context for debugging
    throw new Error(`Decryption failed: ${error.message}`);
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const sendWithRetry = async (sendFn, operationName = 'Operation', maxRetries = MAX_RETRIES) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sendFn();
    } catch (err) {
      const errorName = err?.name || err?.Code || err?.code;
      const statusCode = err?.$metadata?.httpStatusCode;
      const message = err?.message || '';
      const isThrottling = [
        'Throttling',
        'ThrottlingException',
        'TooManyRequestsException',
        'RequestLimitExceeded',
        'SlowDown'
      ].includes(errorName) || statusCode === 429 || message.includes('Rate exceeded');

      if (isThrottling) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`[THROTTLE] ${operationName} throttled - error: ${errorName || statusCode}, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw new Error(`[THROTTLE] ${operationName} - max retries exceeded`);
};

export const throttle = async (tasks, rateLimitPerSecond = TPS_LIMIT) => {
  for (let i = 0; i < tasks.length; i++) {
    await tasks[i]();
    if ((i + 1) % rateLimitPerSecond === 0) {
      console.log(`Throttling: waiting 1 second after ${rateLimitPerSecond} requests`);
      await sleep(1000);
    }
  }
};
