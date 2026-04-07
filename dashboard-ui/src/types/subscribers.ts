export interface SubscriberCountResponse {
  totalSubscribers: number;
}

export interface SubscriberTrendPoint {
  issueNumber: number;
  subscribers: number;
  publishedAt?: string;
}

export interface SubscriberTrendSummary {
  latestSubscribers: number;
  oldestSubscribers: number;
  netChange: number;
  percentageChange: number;
  pointsReturned: number;
}

export interface SubscriberTrendsResponse {
  points: SubscriberTrendPoint[];
  summary: SubscriberTrendSummary;
}

export interface SubscriberListItem {
  email: string;
  addedAt: string | null;
  firstName?: string;
  lastName?: string;
  lastEngagedIssue: number | null;
}

export interface SubscriberListResponse {
  subscribers: SubscriberListItem[];
  total: number;
}
