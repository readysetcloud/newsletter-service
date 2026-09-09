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
