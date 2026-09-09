import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  REPORT_STATUS,
  REPORT_TYPE,
  releaseReportRangeLock,
  reportPartitionKey,
  reportSortKey
} from './utils/report-record.mjs';

const ddb = new DynamoDBClient();

/** As much of a Step Functions error as is worth showing someone. */
const MAX_REASON = 400;

/**
 * Writes a report's terminal state for the two endings the compile step can't
 * produce itself: a range with no issues in it, and a run that failed.
 *
 * Both exist because an on-demand report is a row before it is a report. It is
 * written as `pending` the moment someone asks for it, and something has to
 * resolve that row or the dashboard shows work that never finishes. The
 * compile step covers the ordinary ending; this covers the other two.
 *
 * The write is an upsert, which is what lets it serve the scheduled path too.
 * A monthly run has no row until it succeeds, so a failure used to leave
 * nothing at all behind — no report, and no record that one was attempted.
 * Now it leaves a failed row.
 *
 * Input: { tenant: { id }, reportId, reportType, periodStart, periodEnd,
 *          periodLabel, month?, monthLabel?, outcome: 'empty' | 'failed',
 *          error? }
 */
export const handler = async (event) => {
  const {
    tenant,
    reportId,
    reportType = REPORT_TYPE.MONTHLY,
    periodStart,
    periodEnd,
    periodLabel,
    month,
    monthLabel,
    outcome,
    error
  } = event;

  const tenantId = tenant.id;
  const failed = outcome === 'failed';
  const now = new Date().toISOString();
  const isMonthly = reportType === REPORT_TYPE.MONTHLY;

  const setClauses = [
    '#status = :status',
    'reportType = :reportType',
    'periodStart = :periodStart',
    'periodEnd = :periodEnd',
    'periodLabel = :periodLabel',
    'createdAt = if_not_exists(createdAt, :now)',
    'GSI1PK = :gsi1pk',
    'GSI1SK = if_not_exists(GSI1SK, :now)'
  ];

  const values = {
    ':status': failed ? REPORT_STATUS.FAILED : REPORT_STATUS.COMPLETE,
    ':reportType': reportType,
    ':periodStart': periodStart,
    ':periodEnd': periodEnd,
    ':periodLabel': periodLabel ?? monthLabel,
    ':now': now,
    ':gsi1pk': reportPartitionKey(tenantId)
  };

  const names = { '#status': 'status' };

  if (failed) {
    setClauses.push('failureReason = :failureReason');
    values[':failureReason'] = summarizeError(error);
  } else {
    // A completed report over a range that contains no issues. It is a real
    // answer to the question asked, not an error, so it is stored as one and
    // the dashboard renders the empty state from `hasIssues`.
    setClauses.push('generatedAt = :now', '#report = :report');
    names['#report'] = 'report';
    values[':report'] = { hasIssues: false, insights: [] };
  }

  if (isMonthly && month) {
    setClauses.push('#month = :month', 'monthLabel = :monthLabel');
    names['#month'] = 'month';
    values[':month'] = month;
    values[':monthLabel'] = monthLabel;
  }

  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: reportPartitionKey(tenantId), sk: reportSortKey(reportId) }),
    UpdateExpression: `SET ${setClauses.join(', ')}`
      + (failed ? '' : ' REMOVE failureReason'),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true })
  }));

  // Whatever the ending, the range is free again — especially after a
  // failure, when somebody will want to try the same dates immediately.
  if (!isMonthly) {
    await releaseReportRangeLock(ddb, { tenantId, reportId, periodStart, periodEnd });
  }

  console.log(`[REPORT] ${reportId} for ${tenantId} finished as ${values[':status']}`);

  return { success: true, reportId, status: values[':status'] };
};

/**
 * A Step Functions catch hands over `{ Error, Cause }`, where `Cause` is a
 * JSON string holding the Lambda's own error message and a stack. The stack is
 * for CloudWatch; what belongs on the record is the one line a person reading
 * the dashboard can act on.
 */
const summarizeError = (error) => {
  if (!error) return 'Unknown error';

  const type = error.Error ?? 'Error';
  let detail = error.Cause ?? '';

  try {
    const parsed = JSON.parse(detail);
    detail = parsed.errorMessage ?? detail;
  } catch {
    // Not every Cause is JSON - a States.Timeout carries a bare string.
  }

  const reason = detail ? `${type}: ${detail}` : type;
  return reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON - 1)}…` : reason;
};
