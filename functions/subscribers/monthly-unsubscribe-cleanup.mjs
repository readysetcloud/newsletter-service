import { DynamoDBClient, DeleteItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, ListContactsCommand, DeleteContactCommand } from "@aws-sdk/client-sesv2";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { getTenant } from "../utils/helpers.mjs";

const ddb = new DynamoDBClient();
const ses = new SESv2Client();

/**
 * Monthly cleanup job that runs on the 1st of each month
 * - Reconciles recent unsubscribes with actual SES contact lists
 * - Cleans up stale unsubscribe records
 * - Reports on data consistency
 */
export const handler = async (event) => {
  const results = {
    tenantsProcessed: 0,
    unsubscribeRecordsFound: 0,
    staleRecordsRemoved: 0,
    inconsistenciesFound: 0,
    errors: []
  };

  try {
    console.log('Starting monthly unsubscribe cleanup job');

    // Get all tenants
    const tenants = await getAllTenants();
    console.log(`Found ${tenants.length} tenants to process`);

    for (const tenant of tenants) {
      try {
        await processTenantCleanup(tenant, results);
        results.tenantsProcessed++;
      } catch (error) {
        console.error(`Error processing tenant ${tenant.pk}:`, error);
        results.errors.push({
          tenant: tenant.pk,
          error: error.message
        });
      }
    }

    // Generate summary report
    const report = generateCleanupReport(results);
    console.log('Monthly cleanup completed:', report);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        summary: report
      })
    };

  } catch (error) {
    console.error('Monthly cleanup job failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

/**
 * Get all tenants from DynamoDB using GSI1
 */
const getAllTenants = async () => {
  const tenants = [];
  let lastEvaluatedKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': 'tenant'
      }),
      ExclusiveStartKey: lastEvaluatedKey
    }));

    if (result.Items) {
      tenants.push(...result.Items.map(item => unmarshall(item)));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return tenants;
};

/**
 * Process cleanup for a single tenant
 */
const processTenantCleanup = async (tenant, results) => {
  const tenantId = tenant.pk;

  // Get all recent unsubscribe records for this tenant
  const unsubscribeRecords = await getRecentUnsubscribes(tenantId);
  results.unsubscribeRecordsFound += unsubscribeRecords.length;

  if (unsubscribeRecords.length === 0) {
    return; // No unsubscribe records to process
  }

  console.log(`Processing ${unsubscribeRecords.length} unsubscribe records for tenant ${tenantId}`);

  // Get current SES contact list
  const sesContacts = await getSESContacts(tenant.list);
  const sesContactsSet = new Set(sesContacts.map(email => email.toLowerCase()));

  // Process each unsubscribe record
  for (const record of unsubscribeRecords) {
    const email = record.email.toLowerCase();
    const unsubscribedAt = new Date(record.unsubscribedAt);
    const now = new Date();
    const daysSinceUnsubscribe = Math.floor((now - unsubscribedAt) / (1000 * 60 * 60 * 24));

    // Check if record is stale (older than 30 days)
    if (daysSinceUnsubscribe > 30) {
      await removeStaleUnsubscribeRecord(tenantId, record.sk);
      results.staleRecordsRemoved++;
      continue;
    }

    // Check for inconsistencies - email still in SES but marked as unsubscribed
    if (sesContactsSet.has(email)) {
      console.warn(`Inconsistency found: ${email} is in recent unsubscribes but still in SES contact list for tenant ${tenantId}`);
      results.inconsistenciesFound++;

      // Attempt to remove from SES to fix the inconsistency
      try {
        await ses.send(new DeleteContactCommand({
          ContactListName: tenant.list,
          EmailAddress: record.email
        }));
        console.log(`Fixed inconsistency: removed ${email} from SES list ${tenant.list}`);
      } catch (removeError) {
        console.error(`Failed to fix inconsistency for ${email}:`, removeError);
      }
    }
  }
};

/**
 * Get all recent unsubscribe records for a tenant
 */
const getRecentUnsubscribes = async (tenantId) => {
  const records = [];
  let lastEvaluatedKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: marshall({
        ':pk': `${tenantId}#recent-unsubscribes`
      }),
      ExclusiveStartKey: lastEvaluatedKey
    }));

    if (result.Items) {
      records.push(...result.Items.map(item => unmarshall(item)));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return records;
};

/**
 * Get all contacts from SES contact list
 */
const getSESContacts = async (contactListName) => {
  if (!contactListName) {
    return [];
  }

  const contacts = [];
  let nextToken;

  try {
    do {
      const result = await ses.send(new ListContactsCommand({
        ContactListName: contactListName,
        NextToken: nextToken
      }));

      if (result.Contacts) {
        contacts.push(...result.Contacts.map(c => c.EmailAddress));
      }

      nextToken = result.NextToken;
    } while (nextToken);
  } catch (error) {
    console.error(`Error fetching SES contacts for list ${contactListName}:`, error);
    // Return empty array if SES list doesn't exist or other error
    return [];
  }

  return contacts;
};

/**
 * Remove stale unsubscribe record from DynamoDB
 */
const removeStaleUnsubscribeRecord = async (tenantId, sortKey) => {
  try {
    await ddb.send(new DeleteItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: `${tenantId}#recent-unsubscribes`,
        sk: sortKey
      })
    }));
  } catch (error) {
    console.error(`Error removing stale unsubscribe record ${sortKey}:`, error);
    throw error;
  }
};

/**
 * Generate cleanup report
 */
const generateCleanupReport = (results) => {
  return {
    timestamp: new Date().toISOString(),
    tenantsProcessed: results.tenantsProcessed,
    unsubscribeRecordsFound: results.unsubscribeRecordsFound,
    staleRecordsRemoved: results.staleRecordsRemoved,
    inconsistenciesFound: results.inconsistenciesFound,
    errorCount: results.errors.length,
    errors: results.errors
  };
};
