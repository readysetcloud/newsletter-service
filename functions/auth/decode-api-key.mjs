import { createHash } from 'crypto';

/**
 * Decodes an API key to extract user and key information
 * @param {string} apiKey - The API key to decode
 * @returns {Object|null} Decoded information or null if invalid
 */
export const decodeApiKey = (apiKey) => {
  try {
    if (!apiKey || !apiKey.startsWith('ak_')) {
      return null;
    }

    // Remove the 'ak_' prefix
    const keyBody = apiKey.substring(3);

    // Split into payload and secret parts
    const parts = keyBody.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [encodedPayload, encodedSecret] = parts;

    // Decode the payload
    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    // Validate payload structure
    if (!payload.t || !payload.k || !payload.ts) {
      return null;
    }

    return {
      tenantId: payload.t,
      keyId: payload.k,
      timestamp: payload.ts,
      secret: encodedSecret,
      fullKey: apiKey
    };

  } catch (error) {
    console.error('Error decoding API key:', error);
    return null;
  }
};

/**
 * Hashes an API key for secure storage/comparison
 * @param {string} keyValue - API key value
 * @returns {string} Hashed key
 */
export const hashApiKey = (keyValue) => {
  return createHash('sha256').update(keyValue).digest('hex');
};
