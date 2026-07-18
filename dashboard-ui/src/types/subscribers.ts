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

export interface BotFlags {
  honeypotTriggered: boolean;
  disposableDomain: boolean;
  suspiciousUserAgent: boolean;
  fastSubmission: boolean;
  suspiciousEmailPattern: boolean;
}

export interface InterestScoreEntry {
  score: number;
  lastScoredAt: string;
}

export interface SubscriberListItem {
  email: string;
  addedAt: string | null;
  firstName?: string;
  lastName?: string;
  lastEngagedIssue: number | null;
  /** Number of distinct issues this subscriber has opened or clicked. */
  engagementCount?: number | null;
  /** Per-topic interest scores accumulated from link clicks, keyed by topic label. */
  interestScores?: Record<string, InterestScoreEntry> | null;
  /** IANA timezone confirmed from engagement geolocation over 3 consecutive issues. */
  timeZone?: string | null;
  suspectedBot?: boolean;
  botFlags?: BotFlags;
}

export interface SubscriberListResponse {
  subscribers: SubscriberListItem[];
  total: number;
}
