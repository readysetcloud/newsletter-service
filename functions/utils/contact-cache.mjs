import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { sendWithRetry } from './helpers.mjs';

const s3 = new S3Client();

/**
 * Try to retrieve contacts from S3 cache
 * @param {string} listName - Name of the contact list
 * @returns {Promise<Object>} Result object with success status and data or reason
 */
export const tryGetContactsFromCache = async (listName) => {
  try {
    const key = `contact-lists/${listName}/contacts.json`;
    const bucket = process.env.NEWSLETTER_BUCKET;

    if (!bucket) {
      return {
        success: false,
        reason: 'NEWSLETTER_BUCKET environment variable not set'
      };
    }

    // Try to get from S3
    const response = await sendWithRetry(async () => {
      return await s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key
      }));
    }, 'S3 GetObject');

    // Parse cache data
    const body = await response.Body.transformToString();
    const cacheData = JSON.parse(body);

    // Validate cache structure
    if (!cacheData.contacts || !Array.isArray(cacheData.contacts)) {
      return {
        success: false,
        reason: 'invalid cache structure - missing contacts array'
      };
    }

    if (!cacheData.exportedAt) {
      return {
        success: false,
        reason: 'invalid cache structure - missing exportedAt timestamp'
      };
    }

    // Check freshness
    const exportedAt = new Date(cacheData.exportedAt);
    const ageMs = Date.now() - exportedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const ageHours = Math.round(ageMs / (1000 * 60 * 60));

    const maxAgeDays = parseInt(process.env.CACHE_MAX_AGE_DAYS || '8', 10);

    if (ageDays > maxAgeDays) {
      return {
        success: false,
        reason: `stale (${ageDays.toFixed(1)} days old, max ${maxAgeDays} days)`
      };
    }

    return {
      success: true,
      contacts: cacheData.contacts,
      ageHours,
      exportedAt: cacheData.exportedAt
    };
  } catch (error) {
    // Handle specific S3 errors
    if (error.name === 'NoSuchKey') {
      return {
        success: false,
        reason: 'not found'
      };
    }

    if (error.name === 'AccessDenied' || error.name === 'Forbidden') {
      console.error('[CACHE] S3 access denied:', error);
      return {
        success: false,
        reason: 'access denied'
      };
    }

    // Handle JSON parse errors
    if (error instanceof SyntaxError) {
      console.error('[CACHE] Failed to parse cache file:', error);
      return {
        success: false,
        reason: 'invalid JSON format'
      };
    }

    // Handle throttling errors that exhausted retries
    if (error.message && error.message.includes('max retries exceeded')) {
      return {
        success: false,
        reason: 'S3 throttled'
      };
    }

    // Generic error handling
    console.error('[CACHE] Error retrieving from S3:', error);
    return {
      success: false,
      reason: `error: ${error.message}`
    };
  }
};
