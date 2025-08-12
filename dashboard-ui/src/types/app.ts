import type { UserProfile, Notification } from './api';

// Application State Types
export interface AppState {
  user: UserState;
  notifications: NotificationState;
  ui: UIState;
}

export interface UserState {
  isAuthenticated: boolean;
  isLoading: boolean;
  profile: UserProfile | null;
  error: string | null;
}

export interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
}

export interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  loading: Record<string, boolean>;
  errors: Record<string, string>;
}

// Form Types
export interface FormState<T = any> {
  data: T;
  errors: Record<string, string>;
  isSubmitting: boolean;
  isDirty: boolean;
  isValid: boolean;
}

// Component Props Types
export interface BaseComponentProps {
  className?: string;
  children?: React.ReactNode;
}

export interface LoadingState {
  isLoading: boolean;
  error?: string | null;
}

// Route Types
export interface RouteConfig {
  path: string;
  component: React.ComponentType;
  requiresAuth: boolean;
  title: string;
}

// API Client Types
export interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
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
  Notification,
  AuthTokens,
  CognitoUser,
} from './api';
