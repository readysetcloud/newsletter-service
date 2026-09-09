/**
 * Key shape and lifecycle vocabulary for stored reports.
 *
 * Reports come from two places — the monthly job, and a tenant asking for one
 * over a date range they picked — and they share a partition so the dashboard
 * can list them as one history:
 *
 *   pk = <tenantId>#report
 *   sk = monthly#<YYYY-MM>     the scheduled report for a calendar month
 *   sk = adhoc#<ulid>          one somebody asked for
 *
 * The monthly key is deliberately unchanged. Report URLs already went out in
 * email, and they still have to resolve.
 *
 * The API exposes an id rather than a sort key, and the two shapes are told
 * apart without a delimiter: `YYYY-MM` is a month, anything else is a ULID.
 * The same rule is implemented on the Rust side in
 * `functions/src/api/controllers/reports.rs`; change one and change the other.
 */

/** Ordering key on GSI1, and the attribute it mirrors. */
export const REPORT_GSI1SK_ATTRIBUTE = 'createdAt';

export const REPORT_STATUS = {
  PENDING: 'pending',
  COMPLETE: 'complete',
  FAILED: 'failed'
};

export const REPORT_TYPE = {
  MONTHLY: 'monthly',
  ADHOC: 'adhoc'
};

const MONTH_ID = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Whether an API-facing report id names a scheduled monthly report.
 *
 * @param {string} reportId
 * @returns {boolean}
 */
export const isMonthlyReportId = (reportId) => MONTH_ID.test(reportId ?? '');

/**
 * The sort key for an API-facing report id.
 *
 * @param {string} reportId - `YYYY-MM`, or a ULID
 * @returns {string}
 */
export const reportSortKey = (reportId) =>
  isMonthlyReportId(reportId)
    ? `${REPORT_TYPE.MONTHLY}#${reportId}`
    : `${REPORT_TYPE.ADHOC}#${reportId}`;

/**
 * The API-facing id for a stored sort key. The inverse of
 * [`reportSortKey`].
 *
 * @param {string} sortKey
 * @returns {string}
 */
export const reportIdFromSortKey = (sortKey) => (sortKey ?? '').replace(/^(monthly|adhoc)#/, '');

/**
 * The partition every one of a tenant's reports lives in.
 *
 * @param {string} tenantId
 * @returns {string}
 */
export const reportPartitionKey = (tenantId) => `${tenantId}#report`;

/**
 * Sort key of the row that reserves a range while a report over it is running.
 *
 * Two requests for the same range used to be told apart by reading the recent
 * rows and looking for a match, which is a check followed by a write: both
 * could read before either wrote, and the read went to an index that is only
 * eventually consistent, so the second request could miss the first outright.
 * A conditional put on this key is the actual guarantee — whoever creates it
 * owns the range.
 *
 * It carries no `GSI1PK`, so it never appears in the report list: that query
 * runs on a sparse index and only sees items that opt in.
 *
 * Deleted when the run reaches a terminal state, with a TTL behind it so a
 * range cannot be reserved forever by a run that vanished.
 *
 * @param {string} periodStart - ISO instant
 * @param {string} periodEnd - ISO instant
 * @returns {string}
 */
export const reportRangeLockKey = (periodStart, periodEnd) => `lock#${periodStart}#${periodEnd}`;

/**
 * Frees the range a finished report was holding.
 *
 * Best effort, and deliberately silent: the report itself is already written
 * by the time this runs, and failing to tidy up must not turn a finished
 * report into a failed one. The lock's TTL clears it either way; this just
 * means somebody can ask about the same range again straight away instead of
 * waiting for that.
 *
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} ddb
 * @param {{ tenantId: string, periodStart: string, periodEnd: string }} range
 */
export const releaseReportRangeLock = async (ddb, { tenantId, periodStart, periodEnd }) => {
  if (!periodStart || !periodEnd) return;

  try {
    const { DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
    const { marshall } = await import('@aws-sdk/util-dynamodb');

    await ddb.send(new DeleteItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: reportPartitionKey(tenantId),
        sk: reportRangeLockKey(periodStart, periodEnd)
      })
    }));
  } catch (error) {
    console.warn('[REPORT] Could not release the range lock; it expires on its own', error);
  }
};
