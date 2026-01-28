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
export function parseApiError(error: unknown): ErrorInfo {
  const errorMessage = getErrorMessage(error);
  const errorName = getErrorName(error);

  // Handle network errors
  if (errorName === 'TypeError' || errorMessage?.includes('fetch')) {
    return {
      message: errorMessage || 'Network error',
      type: 'network',
      retryable: true,
      userFriendly: 'Unable to connect to the server. Please check your internet connection and try again.',
    };
  }

  // Handle timeout errors
  if (errorName === 'AbortError' || errorMessage?.includes('timeout')) {
    return {
      message: errorMessage || 'Request timeout',
      type: 'network',
      retryable: true,
      userFriendly: 'The request took too long to complete. Please try again.',
    };
  }

  // Handle authentication errors
  if (errorMessage?.includes('Authentication required') || errorMessage?.includes('401')) {
    return {
      message: errorMessage,
      type: 'authentication',
      retryable: false,
      userFriendly: 'Your session has expired. Please sign in again.',
    };
  }

  // Handle authorization errors
  if (errorMessage?.includes('Access denied') || errorMessage?.includes('403')) {
    return {
      message: errorMessage,
      type: 'authorization',
      retryable: false,
      userFriendly: 'You do not have permission to perform this action.',
    };
  }

  // Handle validation errors
  if (errorMessage?.includes('validation') || errorMessage?.includes('400')) {
    return {
      message: errorMessage,
      type: 'validation',
      retryable: false,
      userFriendly: 'Please check your input and try again.',
    };
  }

  // Handle server errors
  if (errorMessage?.includes('500') || errorMessage?.includes('Server error')) {
    return {
      message: errorMessage,
      type: 'server',
      retryable: true,
      userFriendly: 'Something went wrong on our end. Please try again in a few moments.',
    };
  }

  // Handle resource not found
  if (errorMessage?.includes('404') || errorMessage?.includes('not found')) {
    return {
      message: errorMessage,
      type: 'unknown',
      retryable: false,
      userFriendly: 'The requested resource was not found.',
    };
  }

  // Handle conflict errors (409)
  if (errorMessage?.includes('409') || errorMessage?.includes('Conflict')) {
    return {
      message: errorMessage,
      type: 'validation',
      retryable: false,
      userFriendly: 'This action cannot be completed due to a conflict with the current state.',
    };
  }

  // Default unknown error
  return {
    message: errorMessage || 'An unexpected error occurred',
    type: 'unknown',
    retryable: false,
    userFriendly: 'Something unexpected happened. Please try again or contact support if the problem persists.',
  };
}

/**
 * Get user-friendly error message based on error type and context
 */
export function getUserFriendlyErrorMessage(error: unknown, context?: string): string {
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

      case 'sender':
        return getSenderErrorMessage(error, errorInfo);

      case 'issue':
        return getIssueErrorMessage(error, errorInfo);

      default:
        return errorInfo.userFriendly;
    }
  }

  return errorInfo.userFriendly;
}

/**
 * Get issue-specific error messages
 */
function getIssueErrorMessage(error: unknown, errorInfo: ErrorInfo): string {
  const errorMessage = getErrorMessage(error);

  // Handle 409 Conflict for issues
  if (errorMessage?.includes('409') || errorMessage?.includes('Conflict') || errorMessage?.includes('cannot be modified')) {
    return 'This issue cannot be edited or deleted because it has already been published or scheduled.';
  }

  // Handle 404 for issues
  if (errorMessage?.includes('404') || errorMessage?.includes('not found')) {
    return 'The issue you are looking for was not found. It may have been deleted.';
  }

  // Handle by error type for issue context
  switch (errorInfo.type) {
    case 'validation':
      return 'Please check your issue information and try again.';
    case 'authorization':
      return 'You don\'t have permission to manage this issue.';
    case 'network':
      return 'Unable to connect to the server. Please check your internet connection and try again.';
    case 'server':
      return 'Our service is temporarily unavailable. Please try again in a few moments.';
    default:
      return `Issue operation failed: ${errorInfo.userFriendly}`;
  }
}

/**
 * Get sender-specific error messages
 */
function getSenderErrorMessage(error: unknown, errorInfo: ErrorInfo): string {
  // Handle specific sender error codes
  if (typeof error === 'object' && error !== null && 'errorCode' in error) {
    const errorCode = (error as { errorCode?: string }).errorCode;
    switch (errorCode) {
      case 'INVALID_EMAIL':
        return 'Please enter a valid email address (e.g., newsletter@yourdomain.com)';
      case 'INVALID_DOMAIN':
        return 'Please enter a valid domain name (e.g., yourdomain.com)';
      case 'EMAIL_ALREADY_EXISTS':
        return 'This email address is already configured. Please use a different email or update the existing one.';
      case 'DOMAIN_ALREADY_EXISTS':
        return 'This domain is already being verified. Please wait for verification to complete or use a different domain.';
      case 'SENDER_LIMIT_EXCEEDED':
        return 'You\'ve reached the maximum number of sender emails for your plan. Upgrade to add more senders.';
      case 'DNS_VERIFICATION_NOT_ALLOWED':
        return 'Domain verification is not available on your current plan. Upgrade to Creator tier or higher to use this feature.';
      case 'MAILBOX_VERIFICATION_NOT_ALLOWED':
        return 'Email verification is not available on your current plan. Please contact support.';
      case 'SENDER_NOT_FOUND':
        return 'The sender email was not found. It may have been deleted or you may not have permission to access it.';
      case 'DOMAIN_NOT_FOUND':
        return 'Domain verification not found. Please initiate domain verification first.';
      case 'SES_IDENTITY_CREATION_FAILED':
        return 'Failed to set up email verification with our email service. Please try again or contact support if the issue persists.';
      case 'SES_IDENTITY_DELETION_FAILED':
        return 'The sender has been removed from your account, but cleanup of the email service may have failed. This won\'t affect your ability to add new senders.';
      case 'SES_VERIFICATION_FAILED':
        return 'Email verification failed. Please check your email for the verification link or try resending the verification email.';
      case 'SES_QUOTA_EXCEEDED':
        return 'Email service quota exceeded. Please wait a few minutes before trying again.';
      case 'DNS_RECORD_GENERATION_FAILED':
        return 'Failed to generate DNS verification records. Please try again or contact support.';
      case 'DNS_PROPAGATION_TIMEOUT':
        return 'DNS verification is taking longer than expected. Please check that your DNS records are correctly configured.';
      case 'TOO_MANY_REQUESTS':
        return 'Too many requests. Please wait a moment before trying again.';
      case 'VERIFICATION_ATTEMPTS_EXCEEDED':
        return 'Too many verification attempts. Please wait 15 minutes before trying again.';
      default:
        break;
    }
  }

  // Handle by error type for sender context
  switch (errorInfo.type) {
    case 'validation':
      return 'Please check your sender email information and try again.';
    case 'authorization':
      return 'You don\'t have permission to manage sender emails. Please check your account permissions.';
    case 'network':
      return 'Unable to connect to the email service. Please check your internet connection and try again.';
    case 'server':
      return 'Our email service is temporarily unavailable. Please try again in a few moments.';
    default:
      return `Sender operation failed: ${errorInfo.userFriendly}`;
  }
}

/**
 * Determine if an error should trigger a retry
 */
export function shouldRetryError(error: unknown): boolean {
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
export function formatErrorForLogging(error: unknown, context?: string): string {
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
export function handleComponentError(error: Error, errorInfo: unknown): void {
  console.error('Component Error:', formatErrorForLogging(error, 'Component'));
  console.error('Error Info:', errorInfo);

  // In production, you might want to send this to an error reporting service
  if (import.meta.env.PROD) {
    // Example: sendToErrorReporting(error, errorInfo);
  }
}

/**
 * Validation error helpers
 */
export function extractValidationErrors(error: unknown): Record<string, string> {
  const errors: Record<string, string> = {};

  if (typeof error === 'object' && error !== null && 'details' in error) {
    const details = (error as { details?: Record<string, unknown> }).details;
    if (details && typeof details === 'object') {
      Object.entries(details).forEach(([field, message]) => {
        errors[field] = typeof message === 'string' ? message : 'Invalid value';
      });
    }
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
export function getErrorToastConfig(error: unknown, context?: string) {
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

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

function getErrorName(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.name;
  }
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}
