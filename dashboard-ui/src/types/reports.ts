/**
 * Types for the monthly newsletter performance reports feature.
 *
 * These mirror the backend contract for `GET /reports` (list) and
 * `GET /reports/{id}` (detail). They are intentionally kept in a dedicated
 * `reports.ts` module (separate from the sponsorship `report.ts`) and are not
 * re-exported through `types/index.ts` to avoid name collisions.
 */

export type ReportType = 'monthly' | 'adhoc';

/**
 * Where a report is in its life. A report someone asks for exists as soon as
 * they ask, before it has any content, so the dashboard reads this rather
 * than inferring anything from a missing body.
 */
export type ReportStatus = 'pending' | 'complete' | 'failed';

export type ReportInsightSeverity = 'info' | 'watch' | 'action';

/**
 * Aggregate performance metrics for a reporting period.
 * Rates are decimals (e.g. 0.42 = 42%).
 */
export interface ReportSummaryMetrics {
  issuesSent: number;
  totalDelivered: number;
  totalOpens: number;
  totalClicks: number;
  totalBounces: number;
  totalUnsubscribes: number;
  avgOpenRate: number;
  avgClickRate: number;
  avgClickToOpenRate: number;
  avgBounceRate: number;
}

/**
 * Per-issue subscriber count snapshot used to render growth over the month.
 */
export interface SubscriberGrowthByIssue {
  issue: number;
  date: string;
  subscribers: number;
}

/**
 * Subscriber growth summary for a reporting period.
 * `growthRate` is a decimal (e.g. 0.052 = 5.2%).
 */
export interface ReportSubscriberGrowth {
  startCount: number;
  endCount: number;
  netChange: number;
  growthRate: number;
}

export interface ReportSubscriberGrowthDetail extends ReportSubscriberGrowth {
  byIssue: SubscriberGrowthByIssue[];
}

/**
 * A single report as returned by the `GET /reports` list endpoint.
 */
export interface ReportSummaryItem {
  id: string;
  /** Absent on a report covering a range someone picked. */
  month?: string;
  monthLabel?: string;
  /** How the covered range reads. Present on every report. */
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** When it was started. Reports are listed newest first by this. */
  createdAt: string;
  /** When it finished. Absent while pending. */
  generatedAt?: string;
  reportType: ReportType;
  status: ReportStatus;
  /** Only when `status` is `failed`. */
  failureReason?: string;
  /** Absent until the report finishes, and on a range with no issues in it. */
  summary?: ReportSummaryMetrics;
  subscriberGrowth?: ReportSubscriberGrowth;
}

/** The range to report on. Days, read in the newsletter's timezone. */
export interface CreateReportRequest {
  /** First day covered, `YYYY-MM-DD`. */
  periodStart: string;
  /** Exclusive end, `YYYY-MM-DD`. */
  periodEnd: string;
}

export interface CreateReportResponse {
  id: string;
  status: ReportStatus;
  reportType: ReportType;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
}

/**
 * Top-performing link across the reporting period.
 */
export interface ReportTopLink {
  url: string;
  clicks: number;
  label?: string;
  issues: number[];
}

/**
 * Per-issue performance row within a monthly report.
 */
export interface ReportIssuePerformance {
  id: string;
  issueNumber: number;
  subject: string;
  publishedAt: string;
  delivered: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  bounces: number;
  unsubscribes: number;
  subscribers: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  bounceRate: number;
}

export interface ReportBestIssueMetric {
  issueNumber: number;
  subject: string;
  value: number;
}

export interface ReportBestIssue {
  byOpenRate?: ReportBestIssueMetric;
  byClickRate?: ReportBestIssueMetric;
  byClicks?: ReportBestIssueMetric;
}

export interface ReportInsight {
  type: string;
  severity: ReportInsightSeverity;
  title: string;
  detail: string;
  recommendation?: string;
}

/**
 * The `report` payload nested in the detail response.
 */
export interface MonthlyReportBody {
  summary: ReportSummaryMetrics;
  subscriberGrowth: ReportSubscriberGrowthDetail;
  topLinks: ReportTopLink[];
  issues: ReportIssuePerformance[];
  bestIssue: ReportBestIssue;
  insights: ReportInsight[];
}

/**
 * A full monthly report as returned by `GET /reports/{id}`.
 */
export interface MonthlyReport {
  id: string;
  month?: string;
  monthLabel?: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  generatedAt?: string;
  reportType: ReportType;
  status: ReportStatus;
  failureReason?: string;
  /**
   * Null while the report is pending or after it failed, and the empty shape
   * when the range simply contained no issues — a real answer rather than a
   * missing one.
   */
  report: MonthlyReportBody | EmptyReportBody | null;
}

/** A completed report over a range that contained no issues. */
export interface EmptyReportBody {
  hasIssues: false;
  insights: ReportInsight[];
}

/** Whether a report has figures in it to render. */
export function hasReportBody(
  report: MonthlyReportBody | EmptyReportBody | null
): report is MonthlyReportBody {
  return report != null && (report as EmptyReportBody).hasIssues !== false;
}

export interface ListReportsParams {
  limit?: number;
  nextToken?: string;
}

export interface ListReportsResponse {
  reports: ReportSummaryItem[];
  nextToken?: string;
}
