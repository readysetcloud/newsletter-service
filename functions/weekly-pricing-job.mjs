import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const ddb = new DynamoDBClient();
const eventBridge = new EventBridgeClient();

const TABLE_NAME = process.env.TABLE_NAME;
const SUBSCRIBERS_TABLE_NAME = process.env.SUBSCRIBERS_TABLE_NAME;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Query all distinct tenant IDs from the NewsletterTable.
 *
 * Tenants are identified by scanning for items whose sk = "newsletter"
 * (the tenant metadata record). The pk of those items is the tenantId.
 */
async function getAllTenants() {
  const tenants = [];
  let lastKey;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'sk = :sk',
      ExpressionAttributeValues: marshall({ ':sk': 'newsletter' }),
      ProjectionExpression: 'pk',
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));

    if (result.Items) {
      for (const item of result.Items) {
        const record = unmarshall(item);
        tenants.push(record.pk);
      }
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return tenants;
}

/**
 * Check whether a tenant has at least one Published_Issue_With_Analytics
 * (status "published", statsPhase "consolidated").
 *
 * Uses GSI1 with GSI1PK = `{tenantId}#issue` and filters for consolidated stats.
 */
async function hasPublishedIssueWithAnalytics(tenantId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :gsi1pk',
    FilterExpression: 'statsPhase = :phase',
    ExpressionAttributeValues: marshall({
      ':gsi1pk': `${tenantId}#issue`,
      ':phase': 'consolidated'
    }),
    Limit: 1
  }));

  return (result.Items?.length ?? 0) > 0;
}

/**
 * Get the subscriber count for a tenant from the SubscribersTable.
 */
async function getSubscriberCount(tenantId) {
  let count = 0;
  let lastKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: marshall({ ':tenantId': tenantId }),
      Select: 'COUNT',
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));

    count += result.Count || 0;
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return count;
}

// ---------------------------------------------------------------------------
// Tenant Eligibility
// ---------------------------------------------------------------------------

/**
 * Filter a list of tenant objects to only those eligible for weekly pricing.
 *
 * A tenant is eligible when:
 *   1. It has at least one Published_Issue_With_Analytics (an issue entry with
 *      status "published" and statsPhase "consolidated").
 *   2. Its subscriber count is greater than zero.
 *
 * Each tenant object in the input array must have:
 *   - tenantId: string
 *   - issues: array of { status, statsPhase } objects
 *   - subscriberCount: number
 *
 * Exported for unit / property-based testing.
 */
export function filterEligibleTenants(tenants) {
  return tenants.filter((tenant) => {
    const hasAnalytics = (tenant.issues || []).some(
      (issue) => issue.status === 'published' && issue.statsPhase === 'consolidated'
    );
    return hasAnalytics && (tenant.subscriberCount ?? 0) > 0;
  });
}

// ---------------------------------------------------------------------------
// Controlled Concurrency
// ---------------------------------------------------------------------------

/**
 * Process an array of items with a configurable concurrency limit.
 *
 * @param {Array} items - Items to process.
 * @param {number} concurrency - Maximum number of parallel executions.
 * @param {Function} fn - Async function to call per item.
 * @returns {Promise<Array<{ item, success, result?, error? }>>}
 */
async function processWithConcurrency(items, concurrency, fn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      try {
        const result = await fn(item);
        results[currentIndex] = { item, success: true, result };
      } catch (err) {
        results[currentIndex] = { item, success: false, error: err.message };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// EventBridge Publishing
// ---------------------------------------------------------------------------

/**
 * Publish a pricing recalculation event to EventBridge for a single tenant.
 */
async function publishPricingEvent(tenantId) {
  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'newsletter-service',
      DetailType: 'PRICING_RECALCULATION_REQUESTED',
      Detail: JSON.stringify({
        tenantId,
        isWeeklyJob: true,
        timestamp: new Date().toISOString()
      })
    }]
  }));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (event) => {
  const executionStart = Date.now();
  const concurrency = parseInt(process.env.WEEKLY_JOB_CONCURRENCY, 10) || 5;

  console.log('[WEEKLY-JOB] Starting weekly pricing job', { concurrency });

  try {
    // 1. Query all tenants
    const tenantIds = await getAllTenants();
    console.log(`[WEEKLY-JOB] Found ${tenantIds.length} total tenants`);

    // 2. Check eligibility for each tenant
    const tenantChecks = await processWithConcurrency(tenantIds, concurrency, async (tenantId) => {
      const [hasAnalytics, subscriberCount] = await Promise.all([
        hasPublishedIssueWithAnalytics(tenantId),
        getSubscriberCount(tenantId)
      ]);
      return { tenantId, hasAnalytics, subscriberCount };
    });

    const eligibleTenantIds = tenantChecks
      .filter((r) => r.success && r.result.hasAnalytics && r.result.subscriberCount > 0)
      .map((r) => r.result.tenantId);

    console.log(`[WEEKLY-JOB] ${eligibleTenantIds.length} eligible tenants out of ${tenantIds.length}`);

    // 3. Publish pricing events for each eligible tenant
    const results = await processWithConcurrency(eligibleTenantIds, concurrency, async (tenantId) => {
      return publishPricingEvent(tenantId);
    });

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    for (const failure of failed) {
      console.error(`[WEEKLY-JOB] Tenant ${failure.item} failed:`, failure.error);
    }

    const duration = Date.now() - executionStart;
    console.log(`[WEEKLY-JOB] Completed in ${duration}ms`, {
      total: tenantIds.length,
      eligible: eligibleTenantIds.length,
      succeeded,
      failed: failed.length
    });

    return {
      success: true,
      total: tenantIds.length,
      eligible: eligibleTenantIds.length,
      succeeded,
      failed: failed.length,
      duration
    };
  } catch (err) {
    const duration = Date.now() - executionStart;
    console.error(`[WEEKLY-JOB] Job failed in ${duration}ms`, {
      error: err.message,
      stack: err.stack
    });

    throw err;
  }
};
