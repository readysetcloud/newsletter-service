import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

const ddb = new DynamoDBClient();
const sfn = new SFNClient();
const cognito = new CognitoIdentityProviderClient();

const TABLE_NAME = process.env.TABLE_NAME;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;
const USER_POOL_ID = process.env.USER_POOL_ID;

// Step Functions rejects an execution name longer than this.
const EXECUTION_NAME_MAX_LENGTH = 80;

/**
 * Compute the reporting window for the month prior to `now`.
 * Returns the month key (YYYY-MM), a human label, and the ISO window bounds.
 */
export const getReportingWindow = (now = new Date()) => {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  const year = periodStart.getUTCFullYear();
  const month = String(periodStart.getUTCMonth() + 1).padStart(2, '0');

  return {
    month: `${year}-${month}`,
    monthLabel: periodStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
};

/**
 * List all tenant records via GSI1 (GSI1PK = "tenant"), projecting the fields
 * needed to fan out a per-tenant report run. Using the index avoids a table Scan.
 *
 * NOTE: a tenant record only appears here once it carries GSI1PK="tenant". Both
 * onboarding paths set it, but records that predate the key need
 * `scripts/backfill-tenant-gsi.mjs` run once against the table or they are
 * invisible to this job.
 */
const getAllTenants = async () => {
  const tenants = [];
  let lastKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: marshall({ ':gsi1pk': 'tenant' }),
      ProjectionExpression: 'pk, email, createdBy',
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));

    if (result.Items) {
      for (const item of result.Items) {
        const record = unmarshall(item);
        tenants.push({ id: record.pk, email: record.email, createdBy: record.createdBy });
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return tenants;
};

/**
 * The tenant record's `email` attribute is not reliably an address. The
 * self-serve path (tenant-finalization.asl.json, "UpdateTenantRecord") writes it
 * as a map of the tenant's SES setup - `{ tenantArn, contactList }` - and the
 * brand-onboarding path (create_tenant_with_brand_data in brand.rs) never writes
 * it at all. Only the external "Add/Update Tenant" event can leave a real address
 * there. Handing the map straight through as `to.email` is why no monthly report
 * has ever landed in an inbox: send-email-v2 queries the subscribers table with
 * it as the sort key, which is typed S, and the send dies before SES sees it.
 *
 * @returns {string|null} the address if this record already carries one
 */
export const tenantRecordEmail = (record) => {
  const value = record?.email;
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? value.trim()
    : null;
};

/**
 * Resolve the tenant owner's address from Cognito by the `createdBy` sub, the
 * same lookup `find_user_email_by_sub` (profile.rs) does. The address lives on
 * the Cognito user, not in DynamoDB - every other path that mails a tenant gets
 * it off the caller's token, which a scheduled job has no equivalent of.
 */
const findOwnerEmail = async (sub) => {
  if (!sub || !USER_POOL_ID) return null;

  const result = await cognito.send(new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
    Filter: `sub = "${sub}"`,
    Limit: 1
  }));

  const attributes = result.Users?.[0]?.Attributes ?? [];
  return attributes.find((attr) => attr.Name === 'email')?.Value ?? null;
};

/**
 * The address this tenant's report should be mailed to, or null when there is
 * none to be found. A null is not fatal: compile-monthly-report still persists
 * the report for the dashboard and skips only the email.
 */
const resolveRecipient = async (tenant, cache) => {
  const onRecord = tenantRecordEmail(tenant);
  if (onRecord) return onRecord;

  const sub = tenant.createdBy;
  if (!sub) return null;
  if (cache.has(sub)) return cache.get(sub);

  try {
    const email = await findOwnerEmail(sub);
    cache.set(sub, email);
    return email;
  } catch (error) {
    console.error(`[MONTHLY-REPORT-JOB] Cognito lookup failed for ${tenant.id}:`, error.message);
    return null;
  }
};

/**
 * Returns true when the tenant published at least one issue inside the window.
 * GSI1SK is the padded issue number, so we range on the publishedAt attribute.
 */
const hasIssuesInWindow = async (tenantId, periodStart, periodEnd) => {
  let lastKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      FilterExpression: 'publishedAt BETWEEN :start AND :end',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': `${tenantId}#issue`,
        ':start': periodStart,
        ':end': periodEnd
      }),
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));

    if ((result.Items?.length ?? 0) > 0) {
      return true;
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return false;
};

/**
 * Scheduled fan-out job (runs on the 1st of each month). For every tenant that
 * published at least one issue in the previous month, it starts a
 * MonthlyReportStateMachine execution that builds, persists, and emails the report.
 */
export const handler = async () => {
  const window = getReportingWindow();
  // periodEnd is exclusive (start of current month); the publishedAt filter is
  // inclusive on both bounds, so step back 1ms to avoid catching this month's sends.
  const filterEnd = new Date(new Date(window.periodEnd).getTime() - 1).toISOString();

  console.log('[MONTHLY-REPORT-JOB] Starting', { month: window.month });

  const tenants = await getAllTenants();
  console.log(`[MONTHLY-REPORT-JOB] Found ${tenants.length} tenants`);

  let started = 0;
  let skipped = 0;
  let withoutRecipient = 0;
  const failures = [];
  const emailBySub = new Map();

  for (const tenant of tenants) {
    try {
      const eligible = await hasIssuesInWindow(tenant.id, window.periodStart, filterEnd);
      if (!eligible) {
        skipped++;
        continue;
      }

      // Resolved here rather than in getAllTenants so the Cognito lookup only
      // runs for the tenants that actually get a report.
      const email = await resolveRecipient(tenant, emailBySub);
      if (!email) {
        withoutRecipient++;
        console.warn(`[MONTHLY-REPORT-JOB] No owner address for tenant ${tenant.id}; its report will be persisted but not emailed`);
      }

      await sfn.send(new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: buildExecutionName(tenant.id, window.month),
        input: JSON.stringify({
          tenant: { id: tenant.id, email },
          month: window.month,
          monthLabel: window.monthLabel,
          periodStart: window.periodStart,
          periodEnd: filterEnd
        })
      }));
      started++;
    } catch (error) {
      console.error(`[MONTHLY-REPORT-JOB] Tenant ${tenant.id} failed:`, error.message);
      failures.push(tenant.id);
    }
  }

  console.log('[MONTHLY-REPORT-JOB] Completed', {
    month: window.month,
    tenants: tenants.length,
    started,
    skipped,
    withoutRecipient,
    failed: failures.length
  });

  return {
    month: window.month,
    tenants: tenants.length,
    started,
    skipped,
    withoutRecipient,
    failed: failures.length
  };
};

const sanitizeName = (value, maxLength) => String(value).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, maxLength);

/**
 * Build the execution name, keeping it inside Step Functions' 80 character cap.
 * The month and timestamp suffix is fixed width, so the tenant id absorbs the
 * trim - a tenant id long enough to overflow used to fail its StartExecution
 * outright, and only for that tenant.
 */
export const buildExecutionName = (tenantId, month, now = Date.now()) => {
  const suffix = `-${month}-${now}`;
  return `${sanitizeName(tenantId, EXECUTION_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
};
