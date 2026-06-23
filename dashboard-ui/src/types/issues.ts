export type IssueStatus = 'draft' | 'scheduled' | 'in progress' | 'published' | 'failed';

/**
 * How an issue's `content` should be authored and interpreted.
 * - `markdown`: content is markdown (rendered to HTML on publish).
 * - `json`: content is a JSON data object rendered against a selected template.
 */
export type IssueContentType = 'markdown' | 'json';

export interface IssueListItem {
  id: string;
  issueNumber: number;
  subject: string;
  status: IssueStatus;
  createdAt: string;
  publishedAt?: string;
  scheduledAt?: string;
}

export interface IssueStats {
  opens: number;
  clicks: number;
  deliveries: number;
  bounces: number;
  complaints: number;
  subscribers: number;
  subscribes?: number;
  unsubscribes?: number;
  cleaned?: number;
  manualRemovals?: number;
  analytics?: IssueAnalytics;
}

export interface Issue extends IssueListItem {
  content: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  templateId?: string;
  contentType?: IssueContentType;
  stats?: IssueStats;
  insights?: string[];
  insightsV2?: InsightV2[];
  abTest?: AbTest;
  variantStats?: VariantStats[];
}

// ---------------------------------------------------------------------------
// A/B testing
// ---------------------------------------------------------------------------

/** Which attribute an A/B test varies. */
export type AbTestDimension = 'subject' | 'sendTime';

/** Metric used to decide the winner. */
export type AbTestWinMetric = 'openRate' | 'clickRate';

/** Lifecycle of a managed A/B test. */
export type AbTestStatus = 'pending' | 'testing' | 'evaluating' | 'sent' | 'inconclusive';

export type VariantId = 'a' | 'b';

export interface AbTestVariant {
  variantId: VariantId;
  /** Subject line for this variant (subject-dimension tests). */
  subject?: string;
  /** Absolute send time for this variant (send-time tests). */
  sendAt?: string;
}

export interface VariantEvaluation {
  successes: number;
  deliveries: number;
  rate: number;
}

export interface AbTestEvaluation {
  winMetric: AbTestWinMetric;
  confidence: number;
  minSamplePerVariant: number;
  variantA: VariantEvaluation;
  variantB: VariantEvaluation;
  zScore: number;
  pValue: number;
  significant: boolean;
  winnerVariantId: VariantId | null;
  decidedAt: string;
  /** Winning send time, recorded for send-time tests. */
  winningSendAt?: string;
}

export interface AbTest {
  testId?: string;
  dimension: AbTestDimension;
  variants: AbTestVariant[];
  winMetric?: AbTestWinMetric;
  confidence?: number;
  minSamplePerVariant?: number;
  testFraction?: number;
  evaluateAfterMinutes?: number;
  status?: AbTestStatus;
  winnerVariantId?: VariantId | null;
  evaluation?: AbTestEvaluation | null;
}

/** Per-variant engagement counters returned alongside an issue. */
export interface VariantStats {
  variantId: VariantId;
  opens: number;
  clicks: number;
  deliveries: number;
  sends?: number;
  bounces?: number;
  complaints?: number;
}

export interface TopPerformer {
  id: string;
  subject: string;
  openRate: number;
  clickRate: number;
}

export interface IssueMetrics {
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  bounceRate: number;
  delivered: number;
  opens: number;
  clicks: number;
  bounces: number;
  complaints: number;
  subscribers: number;
  subscribes?: number;
  unsubscribes?: number;
  cleaned?: number;
  manualRemovals?: number;
}

export interface IssueTrendItem {
  id: string;
  metrics: IssueMetrics;
  analyticsSummary?: {
    engagementType?: EngagementType;
    trafficSource?: TrafficSource;
  };
}

export interface TrendAggregates {
  avgOpenRate: number;
  avgClickRate: number;
  avgClickToOpenRate: number;
  avgBounceRate: number;
  totalDelivered: number;
  issueCount: number;
}

export interface TrendComparison {
  current: number;
  previous: number;
  percentChange: number;
  direction: 'up' | 'down' | 'stable';
}

export interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical';
  label: 'Stable' | 'Declining' | 'Improving';
}

export interface BestWorstIssues {
  best: {
    id: string;
    issueNumber: number;
    subject?: string;
    score: number;
  } | null;
  worst: {
    id: string;
    issueNumber: number;
    subject?: string;
    score: number;
  } | null;
}

export interface TrendsData {
  issues: IssueTrendItem[];
  aggregates: TrendAggregates;
  previousPeriodAggregates?: TrendAggregates;
}

export interface CreateIssueRequest {
  subject: string;
  content: string;
  issueNumber?: number;
  scheduledAt?: string;
  metadata?: Record<string, unknown>;
  templateId?: string;
  contentType?: IssueContentType;
  abTest?: AbTest;
}

export interface UpdateIssueRequest {
  subject?: string;
  content?: string;
  scheduledAt?: string;
  metadata?: Record<string, unknown>;
  status?: 'published';
  templateId?: string;
  contentType?: IssueContentType;
  /** An explicit `null` clears a previously-saved A/B test. */
  abTest?: AbTest | null;
}

export interface ListIssuesParams {
  limit?: number;
  nextToken?: string;
  status?: IssueStatus;
}

export interface LinkPerformance {
  url: string;
  clicks: number;
  percentOfTotal: number;
  position: number;
  geoDistribution?: GeoData[];
}

export interface ClickDecayPoint {
  hour: number;
  clicks: number;
  cumulativeClicks: number;
}

export interface OpenDecayPoint {
  hour: number;
  opens: number;
  cumulativeOpens: number;
}

export interface GeoData {
  country: string;
  clicks: number;
  opens: number;
  uniqueClickUsers?: number;
  uniqueOpenUsers?: number;
  uniqueUsers?: number;
}

export interface DeviceBreakdown {
  desktop: number;
  mobile: number;
  tablet: number;
}

export interface TimingMetrics {
  medianTimeToOpen: number;
  p95TimeToOpen: number;
  medianTimeToClick: number;
  p95TimeToClick: number;
}

export interface EngagementType {
  newClickers: number;
  returningClickers: number;
}

export interface TrafficSource {
  clicks: {
    email: number;
    web: number;
  };
  // Note: Opens do not have traffic source attribution (not available in SES events)
}

export interface BounceReasons {
  permanent: number;
  temporary: number;
  suppressed: number;
}

export interface ComplaintDetail {
  email: string;
  timestamp: string;
  complaintType: string;
}

/** Per-variant rollup included in consolidated analytics/reports. */
export interface AbTestVariantAnalytics {
  variantId: VariantId;
  subject?: string;
  sendAt?: string;
  opens: number;
  clicks: number;
  deliveries: number;
  openRate: number;
  clickRate: number;
}

export interface AbTestAnalytics {
  dimension: AbTestDimension;
  winMetric: AbTestWinMetric;
  status?: AbTestStatus;
  winnerVariantId?: VariantId | null;
  variants: AbTestVariantAnalytics[];
  evaluation?: AbTestEvaluation | null;
}

export interface IssueAnalytics {
  links: LinkPerformance[];
  clickDecay: ClickDecayPoint[];
  openDecay?: OpenDecayPoint[];
  geoDistribution: GeoData[];
  deviceBreakdown: DeviceBreakdown;
  timingMetrics: TimingMetrics;
  engagementType: EngagementType;
  trafficSource: TrafficSource;
  bounceReasons: BounceReasons;
  complaintDetails: ComplaintDetail[];
  abTest?: AbTestAnalytics;
}

export interface InsightEvidence {
  metric: string;
  value?: string;
  benchmark?: string;
  deltaPct?: string;
  note?: string;
}

export interface InsightV2 {
  type: string;
  severity: 'info' | 'watch' | 'action';
  confidence: 'low' | 'med' | 'high';
  summary: string;
  recommendation: string;
  evidence?: InsightEvidence[];
}
