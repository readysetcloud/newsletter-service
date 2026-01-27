import type { ComponentType, ReactNode } from 'react';
import type { UserProfile } from './api';

// Application State Types
export interface AppState {
  user: UserState;
  ui: UIState;
}

export interface UserState {
  isAuthenticated: boolean;
  isLoading: boolean;
  profile: UserProfile | null;
  error: string | null;
}

export interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  loading: Record<string, boolean>;
  errors: Record<string, string>;
}

// Form Types
export interface FormState<T = unknown> {
  data: T;
  errors: Record<string, string>;
  isSubmitting: boolean;
  isDirty: boolean;
  isValid: boolean;
}

// Component Props Types
export interface BaseComponentProps {
  className?: string;
  children?: ReactNode;
}

export interface LoadingState {
  isLoading: boolean;
  error?: string | null;
}

// Route Types
export interface RouteConfig {
  path: string;
  component: ComponentType;
  requiresAuth: boolean;
  title: string;
}

// API Client Types
export interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface ApiClientConfig {
  baseURL: string;
  timeout: number;
  retries: number;
  retryDelay: number;
}

// Re-export types from api.ts for convenience
export type {
  ApiResponse,
  ApiError,
  UserProfile,
  BrandInfo,
  PersonalInfo,
  SocialLink,
  UserPreferences,
  ApiKey,
  CreateApiKeyRequest,
  ApiKeyListResponse,
  DashboardData,
  ActivityItem,
  BrandUpdateRequest,
  BrandPhotoUploadRequest,
  BrandPhotoUploadResponse,
  AuthTokens,
  CognitoUser,
} from './api';

// Re-export billing types for convenience
export type {
  SubscriptionPlan,
  PlanLimits,
  Subscription,
  SubscriptionStatus,
  SubscriptionStatusResponse,
  UsageMetrics,
  BillingInfo,
  PaymentMethod,
  BillingAddress,
  CheckoutSessionRequest,
  CheckoutSessionResponse,
  CustomerPortalRequest,
  CustomerPortalResponse,
  PlanChangeRequest,
  PlanChangeResponse,
  BillingAlert,
  PlanSelectionFormData,
  BillingPreferencesFormData,
  BillingApiResponse,
  BillingError,
  BillingLoadingState,
} from './billing';
