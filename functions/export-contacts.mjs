import { SESv2Client, ListContactListsCommand, ListContactsCommand } from "@aws-sdk/client-sesv2";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { sendWithRetry } from './utils/helpers.mjs';

const ses = new SESv2Client();
const s3 = new S3Client();

/**
 * Get all contact lists from SES with pagination
 * @returns {Promise<string[]>} Array of contact list names
 */
const getAllContactLists = async () => {
  const lists = [];
  let nextToken;

  do {
    const response = await sendWithRetry(async () => {
      return await ses.send(new ListContactListsCommand({ NextToken: nextToken }));
    }, 'ListContactLists');

    if (response.ContactLists?.length) {
      lists.push(...response.ContactLists.map(list => list.ContactListName));
    }
    nextToken = response.NextToken;
  } while (nextToken);

  return lists;
};

/**
 * Export a single contact list to S3
 * @param {string} listName - Name of the contact list to export
 * @returns {Promise<string[]>} Array of exported contact email addresses
 */
const exportContactList = async (listName) => {
  // Retrieve all contacts with pagination
  const contacts = [];
  let nextToken;

  do {
    const response = await sendWithRetry(async () => {
      return await ses.send(new ListContactsCommand({
        ContactListName: listName,
        NextToken: nextToken
      }));
    }, 'ListContacts');

    if (response.Contacts?.length) {
      contacts.push(...response.Contacts.map(c => ({
        email: c.EmailAddress,
        topicPreferences: c.TopicPreferences
      })));
    }
    nextToken = response.NextToken;
  } while (nextToken);

  // Create cache object
  const cacheData = {
    listName,
    exportedAt: new Date().toISOString(),
    contactCount: contacts.length,
    contacts: contacts.map(c => c.email)
  };

  // Store in S3
  const key = `contact-lists/${listName}/contacts.json`;
  await sendWithRetry(async () => {
    return await s3.send(new PutObjectCommand({
      Bucket: process.env.NEWSLETTER_BUCKET,
      Key: key,
      Body: JSON.stringify(cacheData),
      ContentType: 'application/json'
    }));
  }, 'S3 PutObject');

  return contacts.map(c => c.email);
};

/**
 * Invalidate (delete) cache for a specific contact list
 * @param {string} listName - Name of the contact list to invalidate
 * @returns {Promise<void>}
 */
const invalidateContactListCache = async (listName) => {
  const key = `contact-lists/${listName}/contacts.json`;
  await sendWithRetry(async () => {
    return await s3.send(new DeleteObjectCommand({
      Bucket: process.env.NEWSLETTER_BUCKET,
      Key: key
    }));
  }, 'S3 DeleteObject');
  console.log(`[INVALIDATE] Deleted cache for list: ${listName}`);
};

/**
 * Main handler for export-contacts Lambda function
 * Exports all SES contact lists to S3 for caching
 * Supports manual cache invalidation via event.action = 'invalidate'
 * @param {Object} event - Lambda event with optional action and listName
 * @returns {Promise<Object>} Export summary with statistics
 */
export const handler = async (event = {}) => {
  // Validate required environment variables
  if (!process.env.NEWSLETTER_BUCKET) {
    throw new Error('NEWSLETTER_BUCKET environment variable is required');
  }

  // Handle manual cache invalidation
  if (event.action === 'invalidate') {
    console.log('[INVALIDATE] Starting cache invalidation');
    const startTime = Date.now();

    if (event.listName) {
      // Invalidate specific list
      await invalidateContactListCache(event.listName);
      const duration = Date.now() - startTime;
      console.log(`[INVALIDATE] Complete - duration: ${duration}ms`);
      return {
        success: true,
        action: 'invalidate',
        listName: event.listName,
        durationMs: duration
      };
    } else {
      // Invalidate all lists
      const lists = await getAllContactLists();
      let invalidatedCount = 0;
      const errors = [];

      for (const listName of lists) {
        try {
          await invalidateContactListCache(listName);
          invalidatedCount++;
        } catch (error) {
          console.error(`[INVALIDATE] Failed to invalidate ${listName}:`, error);
          errors.push({ listName, error: error.message });
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[INVALIDATE] Complete - invalidated: ${invalidatedCount}, errors: ${errors.length}, duration: ${duration}ms`);
      return {
        success: true,
        action: 'invalidate',
        listsInvalidated: invalidatedCount,
        errors,
        durationMs: duration
      };
    }
  }

  // Default action: export all contact lists
  console.log('[EXPORT] Starting contact list export');
  const startTime = Date.now();

  let totalLists = 0;
  let totalContacts = 0;
  const errors = [];

  try {
    // Get all contact lists
    const lists = await getAllContactLists();
    console.log(`[EXPORT] Found ${lists.length} contact lists`);

    // Export each list
    for (const listName of lists) {
      try {
        const contacts = await exportContactList(listName);
        totalLists++;
        totalContacts += contacts.length;
        console.log(`[EXPORT] Exported ${listName}: ${contacts.length} contacts`);
      } catch (error) {
        console.error(`[EXPORT] Failed to export ${listName}:`, error);
        errors.push({ listName, error: error.message });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[EXPORT] Complete - lists: ${totalLists}, contacts: ${totalContacts}, duration: ${duration}ms, errors: ${errors.length}`);

    return {
      success: true,
      action: 'export',
      listsExported: totalLists,
      totalContacts,
      errors,
      durationMs: duration
    };
  } catch (error) {
    console.error('[EXPORT] Fatal error:', error);
    throw error;
  }
};
