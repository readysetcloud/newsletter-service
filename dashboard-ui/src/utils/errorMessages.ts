/**
 * Utility functions for handling and formatting error messages
 */

export type ErrorType =
  | 'not_found'
  | 'forbidden'
  | 'unauthorized'
  | 'network'
  | 'server'
  | 'timeout'
  | 'unknown';

export interface ErrorDetails {
  type: ErrorType;
  title: string;
  message: string;
  showRetry: boolean;
  showBackButton: boolean;
}

/**
 * Categorizes an error message and returns structured error details
 */
export function getErrorDetails(error: Error | string): ErrorDetails {
  const errorMsg = typeof error === 'string' ? error : error.message;
  const lowerMsg = errorMsg.toLowerCase();

  // Not Found (404)
  if (lowerMsg.includes('404') || lowerMsg.includes('not found')) {
    return {
      type: 'not_found',
      title: 'Not Found',
      message: errorMsg.includes('Issue')
        ? 'The issue you are looking for could not be found.'
        : 'The requested resource could not be found.',
      showRetry: false,
      showBackButton: true,
    };
  }

  // Forbidden (403)
  if (lowerMsg.includes('403') || lowerMsg.includes('forbidden') || lowerMsg.includes('access denied')) {
    return {
      type: 'forbidden',
      title: 'Access Denied',
      message: 'You do not have permission to view this resource.',
      showRetry: false,
      showBackButton: true,
    };
  }

  // Unauthorized (401)
  if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized')) {
    return {
      type: 'unauthorized',
      title: 'Session Expired',
      message: 'Your session has expired. Please log in again.',
      showRetry: false,
      showBackButton: true,
    };
  }

  // Network Error
  if (lowerMsg.includes('network') || lowerMsg.includes('failed to fetch') || lowerMsg.includes('connection')) {
    return {
      type: 'network',
      title: 'Connection Error',
      message: 'Unable to connect. Please check your internet connection and try again.',
      showRetry: true,
      showBackButton: true,
    };
  }

  // Server Error (500)
  if (lowerMsg.includes('500') || lowerMsg.includes('server') || lowerMsg.includes('internal')) {
    return {
      type: 'server',
      title: 'Server Error',
      message: 'Something went wrong on our end. Please try again in a few moments.',
      showRetry: true,
      showBackButton: true,
    };
  }

  // Timeout
  if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out')) {
    return {
      type: 'timeout',
      title: 'Request Timeout',
      message: 'The request took too long to complete. Please try again.',
      showRetry: true,
      showBackButton: true,
    };
  }

  // Unknown/Generic Error
  return {
    type: 'unknown',
    title: 'Error',
    message: errorMsg || 'An unexpected error occurred. Please try again.',
    showRetry: true,
    showBackButton: true,
  };
}

/**
 * Gets a user-friendly error message from an error object
 */
export function getUserFriendlyErrorMessage(error: Error | string): string {
  const details = getErrorDetails(error);
  return details.message;
}

/**
 * Checks if an error is retryable
 */
export function isRetryableError(error: Error | string): boolean {
  const details = getErrorDetails(error);
  return details.showRetry;
}

/**
 * Validates if analytics data is complete and valid
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateAnalyticsData(analytics: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!analytics) {
    return { isValid: false, errors: ['Analytics data is missing'] };
  }

  // Check for required fields
  if (analytics.geoDistribution && !Array.isArray(analytics.geoDistribution)) {
    errors.push('Geographic distribution data is invalid');
  }

  if (analytics.links && !Array.isArray(analytics.links)) {
    errors.push('Link performance data is invalid');
  }

  if (analytics.deviceBreakdown && typeof analytics.deviceBreakdown !== 'object') {
    errors.push('Device breakdown data is invalid');
  }

  // Validate geo distribution entries
  if (Array.isArray(analytics.geoDistribution)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalidGeo = analytics.geoDistribution.some((geo: any) =>
      !geo.country || typeof geo.opens !== 'number' || typeof geo.clicks !== 'number'
    );
    if (invalidGeo) {
      errors.push('Some geographic data entries are invalid');
    }
  }

  // Validate link entries
  if (Array.isArray(analytics.links)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalidLinks = analytics.links.some((link: any) =>
      !link.url || typeof link.clicks !== 'number'
    );
    if (invalidLinks) {
      errors.push('Some link performance entries are invalid');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Handles localStorage errors gracefully
 */
export function safeLocalStorageGet<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.warn(`Failed to read from localStorage (key: ${key}):`, error);
    return defaultValue;
  }
}

/**
 * Handles localStorage set operations gracefully
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeLocalStorageSet(key: string, value: any): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Failed to write to localStorage (key: ${key}):`, error);
    return false;
  }
}

/**
 * Handles sessionStorage errors gracefully
 */
export function safeSessionStorageGet<T>(key: string, defaultValue: T): T {
  try {
    const item = sessionStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.warn(`Failed to read from sessionStorage (key: ${key}):`, error);
    return defaultValue;
  }
}

/**
 * Handles sessionStorage set operations gracefully
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeSessionStorageSet(key: string, value: any): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Failed to write to sessionStorage (key: ${key}):`, error);
    return false;
  }
}
