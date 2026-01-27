// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  errorCode?: string;
  retryAttempts?: number;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

// User Profile Types
export interface UserProfile {
  userId: string;
  email: string;
  brand: BrandInfo;
  profile: PersonalInfo;
  preferences: UserPreferences;
  lastModified: string;
}

export interface BrandInfo {
  brandId?: string;
  brandName?: string;
  website?: string;
  industry?: string;
  brandDescription?: string;
  brandLogo?: string;
  tags?: string[];
}

export interface PersonalInfo {
  firstName?: string;
  lastName?: string;
  links?: SocialLink[];
}

export interface SocialLink {
  url: string;
  name: string;
}

export interface UserPreferences {
  timezone?: string;
  locale?: string;
}

// API Key Types
export interface ApiKey {
  keyId: string;
  name: string;
  description?: string;
  keyValue: string; // Only shown during creation, otherwise "***hidden***"
  createdAt: string;
  lastUsed?: string;
  usageCount: number;
  expiresAt?: string;
  status: 'active' | 'revoked';
  revokedAt?: string;
}

export interface CreateApiKeyRequest {
  name: string;
  description?: string;
  expiresAt?: string;
}

export interface ApiKeyListResponse {
  keys: Omit<ApiKey, 'keyValue'>[];
}

// Dashboard Types
export interface DashboardData {
  tenant: {
    name: string;
    subscribers: number;
    totalIssues: number;
  };
  issues: Issue[];
  subscriberMetrics: SubscriberMetrics;
  performanceOverview: PerformanceOverview;
  timeframe: string;
}

export interface Issue {
  id: string;
  title: string;
  sentDate: string;
  metrics?: IssueMetrics;
  performance?: unknown;
}

export interface IssueMetrics {
  openRate?: number;
  clickThroughRate?: number;
  bounceRate?: number;
  delivered?: number;
}

export interface SubscriberMetrics {
  current: number;
  growth: {
    '7d': number;
    '30d': number;
    '90d': number;
  };
  churnRate: number;
  engagementRate: number;
}

export interface PerformanceOverview {
  avgOpenRate: number;
  avgClickRate: number;
  avgBounceRate: number;
  totalSent: number;
  bestPerformingIssue: Issue | null;
}

export interface ActivityItem {
  id: string;
  type: 'issue_sent' | 'subscriber_added' | 'api_key_created' | 'brand_updated';
  title: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// Brand Management Types
export interface BrandUpdateRequest {
  brandName?: string;
  website?: string;
  industry?: string;
  brandDescription?: string;
  brandLogo?: string;
  tags?: string[];
}

export interface BrandPhotoUploadRequest {
  contentType: string;
  fileName: string;
}

export interface BrandPhotoUploadResponse {
  uploadUrl: string;
  key: string;
  expiresIn: number;
  maxSize: number;
  publicUrl: string;
}

// Authentication Types
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

export interface CognitoUser {
  userId: string;
  email: string;
  emailVerified: boolean;
  groups?: string[];
}

// Sender Email Types
export interface SenderEmail {
  senderId: string;
  email: string;
  name?: string;
  verificationType: 'mailbox' | 'domain';
  verificationStatus: 'pending' | 'verified' | 'failed' | 'verification_timed_out';
  isDefault: boolean;
  domain?: string;
  verificationInitiatedAt: string;
  verificationExpiresAt: string;
  timeRemaining?: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  failureReason?: string;
}

export interface TierLimits {
  tier: 'free-tier' | 'creator-tier' | 'pro-tier';
  maxSenders: number;
  currentCount: number;
  canUseDNS: boolean;
  canUseMailbox: boolean;
}

export interface DomainVerification {
  domain: string;
  verificationStatus: 'pending' | 'verified' | 'failed' | 'verification_timed_out';
  dnsRecords: DnsRecord[];
  instructions: string[];
}

export interface DnsRecord {
  name: string;
  type: string;
  value: string;
  description: string;
}

export interface CreateSenderRequest {
  email: string;
  name?: string;
  verificationType: 'mailbox' | 'domain';
}

export interface UpdateSenderRequest {
  name?: string;
  isDefault?: boolean;
}

export interface VerifyDomainRequest {
  domain: string;
}

export interface GetSendersResponse {
  senders: SenderEmail[];
  tierLimits: TierLimits;
}

// Cleanup and timeout related types
export interface SenderStatusCheckResult {
  senderId: string;
  oldStatus: string;
  newStatus: string;
  statusChanged: boolean;
  action: 'updated' | 'stopped' | 'timeout' | 'cleanup';
  message: string;
}

export interface VerificationTimeoutInfo {
  timeRemaining: string;
  isExpired: boolean;
  expiresAt: string;
  canRetry: boolean;
}
