export type IssueStatus = 'draft' | 'scheduled' | 'published' | 'failed';

export interface IssueListItem {
  id: string;
  issueNumber: number;
  title: string;
  slug: string;
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
  analytics?: IssueAnalytics;
}

export interface Issue extends IssueListItem {
  content: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  stats?: IssueStats;
}

export interface TopPerformer {
  id: string;
  title: string;
  openRate: number;
  clickRate: number;
}

export interface IssueMetrics {
  openRate: number;
  clickRate: number;
  bounceRate: number;
  delivered: number;
  opens: number;
  clicks: number;
  bounces: number;
  complaints: number;
}

export interface IssueTrendItem {
  id: string;
  metrics: IssueMetrics;
}

export interface TrendAggregates {
  avgOpenRate: number;
  avgClickRate: number;
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
    title?: string;
    score: number;
  } | null;
  worst: {
    id: string;
    issueNumber: number;
    title?: string;
    score: number;
  } | null;
}

export interface TrendsData {
  issues: IssueTrendItem[];
  aggregates: TrendAggregates;
  previousPeriodAggregates?: TrendAggregates;
}

export interface CreateIssueRequest {
  title: string;
  content: string;
  slug: string;
  scheduledAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateIssueRequest {
  title?: string;
  content?: string;
  slug?: string;
  scheduledAt?: string;
  metadata?: Record<string, unknown>;
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
}

export interface ClickDecayPoint {
  hour: number;
  clicks: number;
  cumulativeClicks: number;
}

export interface GeoData {
  country: string;
  clicks: number;
  opens: number;
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

export interface IssueAnalytics {
  links: LinkPerformance[];
  clickDecay: ClickDecayPoint[];
  geoDistribution: GeoData[];
  deviceBreakdown: DeviceBreakdown;
  timingMetrics: TimingMetrics;
  engagementType: EngagementType;
  bounceReasons: BounceReasons;
  complaintDetails: ComplaintDetail[];
}
