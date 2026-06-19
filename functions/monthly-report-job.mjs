import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const ddb = new DynamoDBClient();
const sfn = new SFNClient();

const TABLE_NAME = process.env.TABLE_NAME;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

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
 * Scan for all tenant records (sk = "tenant"), projecting the fields needed to
 * fan out a per-tenant report run.
 */
const getAllTenants = async () => {
  const tenants = [];
  let lastKey;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'sk = :sk',
      ExpressionAttributeValues: marshall({ ':sk': 'tenant' }),
      ProjectionExpression: 'pk, email',
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));

    if (result.Items) {
      for (const item of result.Items) {
        const record = unmarshall(item);
        tenants.push({ id: record.pk, email: record.email });
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return tenants;
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
  const failures = [];

  for (const tenant of tenants) {
    try {
      const eligible = await hasIssuesInWindow(tenant.id, window.periodStart, filterEnd);
      if (!eligible) {
        skipped++;
        continue;
      }

      await sfn.send(new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: `${sanitizeName(tenant.id)}-${window.month}-${Date.now()}`,
        input: JSON.stringify({
          tenant: { id: tenant.id, email: tenant.email },
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
    failed: failures.length
  });

  return { month: window.month, tenants: tenants.length, started, skipped, failed: failures.length };
};

const sanitizeName = (value) => String(value).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
