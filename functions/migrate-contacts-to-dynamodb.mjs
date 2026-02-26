import { SESv2Client, ListContactListsCommand, ListContactsCommand } from "@aws-sdk/client-sesv2";
import { DynamoDBClient, BatchWriteItemCommand, UpdateItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { sendWithRetry } from './utils/helpers.mjs';

const ses = new SESv2Client();
const ddb = new DynamoDBClient();

// Batch size for DynamoDB BatchWriteItem (max 25)
const BATCH_SIZE = 25;
// Delay between batches to avoid throttling (milliseconds)
const BATCH_DELAY = 100;

/**
 * Get all contact lists from SESv2 with pagination
 * @returns {Promise<Array<{name: string, tenantId: string}>>} Array of contact list info
 */
const getAllContactLists = async () => {
  const lists = [];
  let nextToken;

  console.log('[MIGRATION] Fetching contact lists from SESv2...');

  do {
    const response = await sendWithRetry(async () => {
      return await ses.send(new ListContactListsCommand({ NextToken: nextToken }));
    }, 'ListContactLists');

    if (response.ContactLists?.length) {
      // Extract tenant ID from contact list name (assuming format: tenant-{tenantId})
      for (const list of response.ContactLists) {
        const listName = list.ContactListName;
        // Try to extract tenant ID from list name
        const tenantId = extractTenantIdFromListName(listName);
        if (tenantId) {
          lists.push({ name: listName, tenantId });
        } else {
          console.warn(`[MIGRATION] Could not extract tenant ID from list: ${listName}`);
        }
      }
    }
    nextToken = response.NextToken;
  } while (nextToken);

  console.log(`[MIGRATION] Found ${lists.length} contact lists`);
  return lists;
};

/**
 * Extract tenant ID from contact list name
 * Assumes format like "tenant-{tenantId}" or just returns the list name as tenant ID
 * @param {string} listName - Contact list name
 * @returns {string|null} Tenant ID or null if cannot extract
 */
const extractTenantIdFromListName = (listName) => {
  // If list name starts with "tenant-", extract the part after
  if (listName.startsWith('tenant-')) {
    return listName.substring(7);
  }
  // Otherwise, use the list name as tenant ID
  return listName;
};

/**
 * Get all contacts from a specific contact list with pagination
 * @param {string} listName - Name of the contact list
 * @returns {Promise<Array<{email: string, firstName?: string, lastName?: string}>>} Array of contacts
 */
const getContactsFromList = async (listName) => {
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
      for (const contact of response.Contacts) {
        const email = contact.EmailAddress?.toLowerCase();
        if (!email) continue;

        const subscriber = { email };

        // Parse attributes if present
        if (contact.AttributesData) {
          try {
            const attributes = JSON.parse(contact.AttributesData);
            if (attributes.firstName) subscriber.firstName = attributes.firstName;
            if (attributes.lastName) subscriber.lastName = attributes.lastName;
          } catch (err) {
            console.warn(`[MIGRATION] Failed to parse attributes for ${email}:`, err.message);
          }
        }

        contacts.push(subscriber);
      }
    }
    nextToken = response.NextToken;
  } while (nextToken);

  console.log(`[MIGRATION] Retrieved ${contacts.length} contacts from list ${listName}`);
  return contacts;
};

/**
 * Write subscribers to DynamoDB Subscribers table in batches
 * @param {string} tenantId - Tenant ID
 * @param {Array<{email: string, firstName?: string, lastName?: string}>} subscribers - Array of subscribers
 * @returns {Promise<{success: number, errors: Array}>} Result with success count and errors
 */
const writeSubscribersToDynamoDB = async (tenantId, subscribers) => {
  let successCount = 0;
  const errors = [];
  const addedAt = new Date().toISOString();

  // Process in batches of 25 (DynamoDB limit)
  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);

    const putRequests = batch.map(subscriber => ({
      PutRequest: {
        Item: marshall({
          tenantId,
          email: subscriber.email,
          ...(subscriber.firstName && { firstName: subscriber.firstName }),
          ...(subscriber.lastName && { lastName: subscriber.lastName }),
          addedAt
        })
      }
    }));

    try {
      const response = await sendWithRetry(async () => {
        return await ddb.send(new BatchWriteItemCommand({
          RequestItems: {
            [process.env.SUBSCRIBERS_TABLE_NAME]: putRequests
          }
        }));
      }, 'BatchWriteItem');

      // Check for unprocessed items
      const unprocessedCount = response.UnprocessedItems?.[process.env.SUBSCRIBERS_TABLE_NAME]?.length || 0;
      const processedCount = batch.length - unprocessedCount;

      successCount += processedCount;

      if (unprocessedCount > 0) {
        console.warn(`[MIGRATION] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${unprocessedCount} unprocessed items for tenant ${tenantId}`);
        // Track unprocessed items as errors
        const unprocessedEmails = response.UnprocessedItems[process.env.SUBSCRIBERS_TABLE_NAME]
          .map(item => item.PutRequest.Item.email.S);
        unprocessedEmails.forEach(email => {
          errors.push({
            email,
            error: 'Unprocessed by DynamoDB (throttled or capacity exceeded)'
          });
        });
      }

      console.log(`[MIGRATION] Wrote batch ${Math.floor(i / BATCH_SIZE) + 1}: ${processedCount}/${batch.length} subscribers for tenant ${tenantId}`);

      // Throttle to avoid overwhelming DynamoDB
      if (i + BATCH_SIZE < subscribers.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    } catch (err) {
      console.error(`[MIGRATION] Failed to write batch for tenant ${tenantId}:`, err);
      batch.forEach(subscriber => {
        errors.push({
          email: subscriber.email,
          error: err.message
        });
      });
    }
  }

  return { success: successCount, errors };
};

/**
 * Update subscriber count in Newsletter table
 * @param {string} tenantId - Tenant ID
 * @param {number} count - New subscriber count
 * @returns {Promise<void>}
 */
const updateSubscriberCount = async (tenantId, count) => {
  try {
    await sendWithRetry(async () => {
      return await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: tenantId,
          sk: 'tenant'
        }),
        UpdateExpression: 'SET #subscribers = :count',
        ExpressionAttributeNames: {
          '#subscribers': 'subscribers'
        },
        ExpressionAttributeValues: marshall({
          ':count': count
        })
      }));
    }, 'UpdateSubscriberCount');

    console.log(`[MIGRATION] Updated subscriber count for tenant ${tenantId}: ${count}`);
  } catch (err) {
    console.error(`[MIGRATION] Failed to update subscriber count for tenant ${tenantId}:`, err);
    throw err;
  }
};

/**
 * Verify subscriber count by querying Subscribers table
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<number>} Actual count of subscribers
 */
const getActualSubscriberCount = async (tenantId) => {
  try {
    let totalCount = 0;
    let lastEvaluatedKey;

    do {
      const response = await sendWithRetry(async () => {
        return await ddb.send(new QueryCommand({
          TableName: process.env.SUBSCRIBERS_TABLE_NAME,
          KeyConditionExpression: 'tenantId = :tenantId',
          ExpressionAttributeValues: marshall({
            ':tenantId': tenantId
          }),
          Select: 'COUNT',
          ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
        }));
      }, 'QuerySubscriberCount');

      totalCount += response.Count || 0;
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return totalCount;
  } catch (err) {
    console.error(`[MIGRATION] Failed to query subscriber count for tenant ${tenantId}:`, err);
    return 0;
  }
};

/**
 * Migrate a single tenant's contacts from SESv2 to DynamoDB
 * @param {string} listName - Contact list name
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Migration result for this tenant
 */
const migrateTenant = async (listName, tenantId) => {
  const startTime = Date.now();
  console.log(`[MIGRATION] Starting migration for tenant ${tenantId} (list: ${listName})`);

  try {
    // Fetch all contacts from SESv2
    const contacts = await getContactsFromList(listName);
    console.log(`[MIGRATION] Found ${contacts.length} contacts for tenant ${tenantId}`);

    if (contacts.length === 0) {
      return {
        tenantId,
        contactListName: listName,
        subscribersMigrated: 0,
        errors: [],
        duration: Date.now() - startTime
      };
    }

    // Write to DynamoDB
    const { success, errors } = await writeSubscribersToDynamoDB(tenantId, contacts);

    // Verify actual count and update Newsletter table
    const actualCount = await getActualSubscriberCount(tenantId);
    await updateSubscriberCount(tenantId, actualCount);

    const duration = Date.now() - startTime;
    console.log(`[MIGRATION] Completed tenant ${tenantId}: ${success} migrated, ${errors.length} errors, ${duration}ms`);

    return {
      tenantId,
      contactListName: listName,
      subscribersMigrated: success,
      errors,
      duration
    };
  } catch (err) {
    console.error(`[MIGRATION] Fatal error migrating tenant ${tenantId}:`, err);
    return {
      tenantId,
      contactListName: listName,
      subscribersMigrated: 0,
      errors: [{ email: 'N/A', error: err.message }],
      duration: Date.now() - startTime
    };
  }
};

/**
 * Main handler for migration Lambda function
 * Migrates all SESv2 contacts to DynamoDB Subscribers table
 * @param {Object} event - Lambda event (optional tenantId to migrate specific tenant)
 * @returns {Promise<Object>} Migration report
 */
export const handler = async (event = {}) => {
  // Validate required environment variables
  if (!process.env.TABLE_NAME) {
    throw new Error('TABLE_NAME environment variable is required');
  }
  if (!process.env.SUBSCRIBERS_TABLE_NAME) {
    throw new Error('SUBSCRIBERS_TABLE_NAME environment variable is required');
  }

  const migrationStartTime = Date.now();
  console.log('[MIGRATION] Starting SESv2 to DynamoDB migration');

  try {
    // Get all contact lists
    const contactLists = await getAllContactLists();

    if (contactLists.length === 0) {
      console.log('[MIGRATION] No contact lists found');
      return {
        success: true,
        startedAt: new Date(migrationStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        tenants: [],
        totalSubscribers: 0,
        totalErrors: 0,
        durationMs: Date.now() - migrationStartTime
      };
    }

    // Filter to specific tenant if provided
    const listsToMigrate = event.tenantId
      ? contactLists.filter(list => list.tenantId === event.tenantId)
      : contactLists;

    if (event.tenantId && listsToMigrate.length === 0) {
      console.warn(`[MIGRATION] No contact list found for tenant: ${event.tenantId}`);
      return {
        success: false,
        error: `No contact list found for tenant: ${event.tenantId}`,
        startedAt: new Date(migrationStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        tenants: [],
        totalSubscribers: 0,
        totalErrors: 0,
        durationMs: Date.now() - migrationStartTime
      };
    }

    console.log(`[MIGRATION] Migrating ${listsToMigrate.length} tenant(s)`);

    // Migrate each tenant
    const results = [];
    for (const { name, tenantId } of listsToMigrate) {
      const result = await migrateTenant(name, tenantId);
      results.push(result);
    }

    // Generate summary report
    const totalSubscribers = results.reduce((sum, r) => sum + r.subscribersMigrated, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
    const durationMs = Date.now() - migrationStartTime;

    const report = {
      success: true,
      startedAt: new Date(migrationStartTime).toISOString(),
      completedAt: new Date().toISOString(),
      tenants: results,
      totalSubscribers,
      totalErrors,
      durationMs
    };

    console.log('[MIGRATION] Migration complete');
    console.log(`[MIGRATION] Summary: ${results.length} tenants, ${totalSubscribers} subscribers, ${totalErrors} errors, ${durationMs}ms`);

    return report;
  } catch (err) {
    console.error('[MIGRATION] Fatal migration error:', err);
    throw err;
  }
};
