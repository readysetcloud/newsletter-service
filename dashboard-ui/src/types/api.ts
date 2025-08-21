// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, any>;
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
  performance?: any;
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
  metadata?: Record<string, any>;
}

// Brand Management Types
export interface BrandUpdateRequest {
  brandName?: string;
  website?: string;
  industry?: string;
  brandDescription?: string;
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

// Notification Types
export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actionUrl?: string;
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
