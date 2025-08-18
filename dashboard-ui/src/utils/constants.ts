// Application constants
export const APP_CONFIG = {
  name: 'Newsletter Admin Dashboard',
  version: '1.0.0',
  description: 'Admin interface for newsletter management',
} as const;

export const API_ENDPOINTS = {
  auth: {
    login: '/auth/login',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
  },
  profile: {
    get: '/me',
    update: '/me/profile',
    brand: '/me/brand',
    uploadPhoto: '/me/brand/photo',
  },
  apiKeys: {
    list: '/api-keys',
    create: '/api-keys',
    get: '/api-keys/:id',
    delete: '/api-keys/:id',
  },
  dashboard: {
    data: '/dashboard',
  },
} as const;

export const STORAGE_KEYS = {
  authToken: 'auth_token',
  refreshToken: 'refresh_token',
  userProfile: 'user_profile',
  notifications: 'notifications',
} as const;

export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
} as const;

export const FORM_VALIDATION = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: 'Please enter a valid email address',
  },
  password: {
    minLength: 8,
    message: 'Password must be at least 8 characters long',
  },
  required: {
    message: 'This field is required',
  },
} as const;
