/**
 * Types for the monthly newsletter performance reports feature.
 *
 * These mirror the backend contract for `GET /reports` (list) and
 * `GET /reports/{id}` (detail). They are intentionally kept in a dedicated
 * `reports.ts` module (separate from the sponsorship `report.ts`) and are not
 * re-exported through `types/index.ts` to avoid name collisions.
 */

export type ReportType = 'monthly';

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
  month: string;
  monthLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  reportType: ReportType;
  summary: ReportSummaryMetrics;
  subscriberGrowth: ReportSubscriberGrowth;
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
  month: string;
  monthLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  reportType: ReportType;
  report: MonthlyReportBody;
}

export interface ListReportsParams {
  limit?: number;
  nextToken?: string;
}

export interface ListReportsResponse {
  reports: ReportSummaryItem[];
  nextToken?: string;
}
