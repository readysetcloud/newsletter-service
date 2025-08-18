/**
 * Error handling utilities for API responses and user-friendly error messages
 */

export interface ErrorInfo {
  message: string;
  type: 'network' | 'authentication' | 'authorization' | 'validation' | 'server' | 'unknown';
  code?: string;
  retryable: boolean;
  userFriendly: string;
}

/**
 * Parse and categorize errors from API respons
 */
export function parseApiError(error: any): ErrorInfo {
  // Handle network errors
  if (error?.name === 'TypeError' || error?.message?.includes('fetch')) {
    return {
      message: error.message || 'Network error',
      type: 'network',
      retryable: true,
      userFriendly: 'Unable to connect to the server. Please check your internet connection and try again.',
    };
  }

  // Handle timeout errors
  if (error?.name === 'AbortError' || error?.message?.includes('timeout')) {
    return {
      message: error.message || 'Request timeout',
      type: 'network',
      retryable: true,
      userFriendly: 'The request took too long to complete. Please try again.',
    };
  }

  // Handle authentication errors
  if (error?.message?.includes('Authentication required') || error?.message?.includes('401')) {
    return {
      message: error.message,
      type: 'authentication',
      retryable: false,
      userFriendly: 'Your session has expired. Please sign in again.',
    };
  }

  // Handle authorization errors
  if (error?.message?.includes('Access denied') || error?.message?.includes('403')) {
    return {
      message: error.message,
      type: 'authorization',
      retryable: false,
      userFriendly: 'You do not have permission to perform this action.',
    };
  }

  // Handle validation errors
  if (error?.message?.includes('validation') || error?.message?.includes('400')) {
    return {
      message: error.message,
      type: 'validation',
      retryable: false,
      userFriendly: 'Please check your input and try again.',
    };
  }

  // Handle server errors
  if (error?.message?.includes('500') || error?.message?.includes('Server error')) {
    return {
      message: error.message,
      type: 'server',
      retryable: true,
      userFriendly: 'Something went wrong on our end. Please try again in a few moments.',
    };
  }

  // Handle resource not found
  if (error?.message?.includes('404') || error?.message?.includes('not found')) {
    return {
      message: error.message,
      type: 'unknown',
      retryable: false,
      userFriendly: 'The requested resource was not found.',
    };
  }

  // Default unknown error
  return {
    message: error?.message || 'An unexpected error occurred',
    type: 'unknown',
    retryable: false,
    userFriendly: 'Something unexpected happened. Please try again or contact support if the problem persists.',
  };
}

/**
 * Get user-friendly error message based on error type and context
 */
export function getUserFriendlyErrorMessage(error: any, context?: string): string {
  const errorInfo = parseApiError(error);

  if (context) {
    switch (context) {
      case 'profile':
        return errorInfo.type === 'validation'
          ? 'Please check your profile information and try again.'
          : `Failed to update profile: ${errorInfo.userFriendly}`;

      case 'brand':
        return errorInfo.type === 'validation'
          ? 'Please check your brand information and try again.'
          : `Failed to update brand: ${errorInfo.userFriendly}`;

      case 'apikey':
        return errorInfo.type === 'validation'
          ? 'Please check your API key details and try again.'
          : `API key operation failed: ${errorInfo.userFriendly}`;

      case 'dashboard':
        return `Failed to load dashboard data: ${errorInfo.userFriendly}`;

      case 'upload':
        return errorInfo.type === 'network'
          ? 'Upload failed due to connection issues. Please try again.'
          : `Upload failed: ${errorInfo.userFriendly}`;

      default:
        return errorInfo.userFriendly;
    }
  }

  return errorInfo.userFriendly;
}

/**
 * Determine if an error should trigger a retry
 */
export function shouldRetryError(error: any): boolean {
  const errorInfo = parseApiError(error);
  return errorInfo.retryable;
}

/**
 * Get retry delay based on attempt number (exponential backoff)
 */
export function getRetryDelay(attemptNumber: number, baseDelay: number = 1000): number {
  return Math.min(baseDelay * Math.pow(2, attemptNumber - 1), 30000); // Max 30 seconds
}

/**
 * Format error for logging (includes more technical details)
 */
export function formatErrorForLogging(error: any, context?: string): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? `[${context}] ` : '';

  if (error instanceof Error) {
    return `${timestamp} ${contextStr}${error.name}: ${error.message}\nStack: ${error.stack}`;
  }

  return `${timestamp} ${contextStr}Error: ${JSON.stringify(error, null, 2)}`;
}

/**
 * Error boundary helper for React components
 */
export function handleComponentError(error: Error, errorInfo: any): void {
  console.error('Component Error:', formatErrorForLogging(error, 'Component'));
  console.error('Error Info:', errorInfo);

  // In production, you might want to send this to an error reporting service
  if (process.env.NODE_ENV === 'production') {
    // Example: sendToErrorReporting(error, errorInfo);
  }
}

/**
 * Validation error helpers
 */
export function extractValidationErrors(error: any): Record<string, string> {
  const errors: Record<string, string> = {};

  if (error?.details && typeof error.details === 'object') {
    Object.entries(error.details).forEach(([field, message]) => {
      errors[field] = typeof message === 'string' ? message : 'Invalid value';
    });
  }

  return errors;
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(message: string, code?: string): { success: false; error: string; code?: string } {
  return {
    success: false,
    error: message,
    ...(code && { code }),
  };
}

/**
 * Toast notification helpers for different error types
 */
export function getErrorToastConfig(error: any, context?: string) {
  const errorInfo = parseApiError(error);

  return {
    title: getErrorTitle(errorInfo.type),
    message: getUserFriendlyErrorMessage(error, context),
    type: 'error' as const,
    duration: errorInfo.retryable ? 5000 : 8000, // Show retryable errors for less time
    action: errorInfo.retryable ? { label: 'Retry', onClick: () => {} } : undefined,
  };
}

function getErrorTitle(errorType: ErrorInfo['type']): string {
  switch (errorType) {
    case 'network':
      return 'Connection Error';
    case 'authentication':
      return 'Authentication Required';
    case 'authorization':
      return 'Access Denied';
    case 'validation':
      return 'Invalid Input';
    case 'server':
      return 'Server Error';
    default:
      return 'Error';
  }
}
