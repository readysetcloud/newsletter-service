import type { AxiosError } from 'axios';

/**
 * Error types for different contexts
 */
export type ErrorContext =
  | 'template'
  | 'snippet'
  | 'preview'
  | 'export'
  | 'import'
  | 'validation'
  | 'network'
  | 'auth'
  | 'permission'
  | 'brand'
  | 'profile'
  | 'sender'
  | 'apikey'
  | 'upload';

/**
 * Structured error information
 */
export interface ErrorInfo {
  message: string;
  code?: string;
  details?: string[];
  suggestions?: string[];
  retryable?: boolean;
  severity?: 'info' | 'warning' | 'error' | 'critical';
}

/**
 * Validation error structure
 */
export interface ValidationError {
  field: string;
  message: string;
  code?: string;
  value?: any;
}

/**
 * API error response structure
 */
export interface ApiErrorResponse {
  message: string;
  code?: string;
  type?: 'network' | 'authentication' | 'authorization' | 'validation' | 'server';
  retryable?: boolean;
  userFriendly?: string;
  errors?: Array<{
    message: string;
    line?: number;
    column?: number;
    type?: string;
    severity?: string;
    code?: string;
  }>;
  details?: Record<string, any>;
}

/**
 * Get user-friendly error message based on error and context
 */
export const getUserFriendlyErrorMessage = (
  error: any,
  context: ErrorContext = 'template'
): string => {
  // Handle network errors
  if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('Network Error')) {
    return 'Unable to connect to the server. Please check your internet connection and try again.';
  }

  // Handle timeout errors
  if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
    return 'The request timed out. Please try again.';
  }

  // Handle axios errors
  if (error?.isAxiosError) {
    const axiosError = error as AxiosError<ApiErrorResponse>;

    // Handle specific HTTP status codes
    switch (axiosError.response?.status) {
      case 400:
        return getContextualErrorMessage(axiosError.response.data, context, 'Invalid request');
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return `You don't have permission to perform this action.`;
      case 404:
        return getNotFoundMessage(context);
      case 409:
        return getConflictMessage(context);
      case 413:
        return 'The file or content is too large. Please reduce the size and try again.';
      case 422:
        return getValidationErrorMessage(axiosError.response.data, context);
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
        return 'A server error occurred. Please try again later.';
      case 502:
      case 503:
      case 504:
        return 'The service is temporarily unavailable. Please try again later.';
      default:
        return getContextualErrorMessage(axiosError.response?.data, context);
    }
  }

  // Handle validation errors
  if (error?.name === 'ValidationError' || error?.errors) {
    return getValidationErrorMessage(error, context);
  }

  // Handle template-specific errors
  if (context === 'template' || context === 'snippet') {
    if (error?.message?.includes('Template validation failed')) {
      return 'The template contains syntax errors. Please check the highlighted issues and try again.';
    }
    if (error?.message?.includes('Snippet validation failed')) {
      return 'The snippet contains syntax errors. Please check the highlighted issues and try again.';
    }
  }

  // Handle preview errors
  if (context === 'preview') {
    if (error?.message?.includes('rendering failed')) {
      return 'Unable to render the preview. Please check your template syntax and try again.';
    }
  }

  // Handle import/export errors
  if (context === 'export') {
    return 'Failed to export templates. Please try again or contact support if the problem persists.';
  }
  if (context === 'import') {
    return 'Failed to import templates. Please check the file format and try again.';
  }

  // Default fallback
  return error?.message || getDefaultErrorMessage(context);
};

/**
 * Get contextual error message from API response
 */
const getContextualErrorMessage = (
  data: ApiErrorResponse | undefined,
  context: ErrorContext,
  fallback?: string
): string => {
  if (data?.message) {
    return data.message;
  }

  if (data?.errors && data.errors.length > 0) {
    const firstError = data.errors[0];
    return firstError.message || fallback || getDefaultErrorMessage(context);
  }

  return fallback || getDefaultErrorMessage(context);
};

/**
 * Get not found message based on context
 */
const getNotFoundMessage = (context: ErrorContext): string => {
  switch (context) {
    case 'template':
      return 'Template not found. It may have been deleted or you may not have access to it.';
    case 'snippet':
      return 'Snippet not found. It may have been deleted or you may not have access to it.';
    default:
      return 'The requested resource was not found.';
  }
};

/**
 * Get conflict message based on context
 */
const getConflictMessage = (context: ErrorContext): string => {
  switch (context) {
    case 'template':
      return 'A template with this name already exists. Please choose a different name.';
    case 'snippet':
      return 'A snippet with this name already exists. Please choose a different name.';
    default:
      return 'A conflict occurred. The resource may have been modified by another user.';
  }
};

/**
 * Get validation error message
 */
const getValidationErrorMessage = (
  data: any,
  context: ErrorContext
): string => {
  if (data?.errors && Array.isArray(data.errors)) {
    const errorCount = data.errors.length;
    const firstError = data.errors[0];

    if (errorCount === 1) {
      return firstError.message || `Validation failed for ${context}`;
    } else {
      return `${errorCount} validation errors found. Please check the highlighted issues.`;
    }
  }

  return `Validation failed for ${context}. Please check your input and try again.`;
};

/**
 * Get default error message based on context
 */
const getDefaultErrorMessage = (context: ErrorContext): string => {
  switch (context) {
    case 'template':
      return 'An error occurred while processing the template. Please try again.';
    case 'snippet':
      return 'An error occurred while processing the snippet. Please try again.';
    case 'preview':
      return 'An error occurred while generating the preview. Please try again.';
    case 'export':
      return 'An error occurred while exporting. Please try again.';
    case 'import':
      return 'An error occurred while importing. Please try again.';
    case 'validation':
      return 'Validation failed. Please check your input and try again.';
    case 'network':
      return 'A network error occurred. Please check your connection and try again.';
    case 'auth':
      return 'Authentication failed. Please sign in again.';
    case 'permission':
      return 'You do not have permission to perform this action.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
};

/**
 * Extract detailed error information from error object
 */
export const getDetailedErrorInfo = (error: any, context: ErrorContext): ErrorInfo => {
  const baseInfo: ErrorInfo = {
    message: getUserFriendlyErrorMessage(error, context),
    severity: 'error',
    retryable: false
  };

  // Handle axios errors
  if (error?.isAxiosError) {
    const axiosError = error as AxiosError<ApiErrorResponse>;
    const status = axiosError.response?.status;
    const data = axiosError.response?.data;

    baseInfo.code = data?.code || `HTTP_${status}`;
    baseInfo.retryable = isRetryableError(status);
    baseInfo.severity = getErrorSeverity(status);

    // Extract detailed errors
    if (data?.errors && Array.isArray(data.errors)) {
      baseInfo.details = data.errors.map(err =>
        err.line ? `Line ${err.line}: ${err.message}` : err.message
      );
    }

    // Add suggestions based on error type
    baseInfo.suggestions = getErrorSuggestions(status, context, data);
  }

  // Handle validation errors
  if (error?.name === 'ValidationError' || error?.errors) {
    baseInfo.code = 'VALIDATION_ERROR';
    baseInfo.severity = 'warning';
    baseInfo.retryable = true;

    if (error.errors && Array.isArray(error.errors)) {
      baseInfo.details = error.errors.map((err: any) => err.message);
    }

    baseInfo.suggestions = [
      'Check the highlighted fields for errors',
      'Ensure all required fields are filled',
      'Verify that the input format is correct'
    ];
  }

  return baseInfo;
};

/**
 * Check if error is retryable based on status code
 */
const isRetryableError = (status?: number): boolean => {
  if (!status) return false;

  // Retryable errors: timeout, server errors, rate limiting
  return [408, 429, 500, 502, 503, 504].includes(status);
};

/**
 * Get error severity based on status code
 */
const getErrorSeverity = (status?: number): ErrorInfo['severity'] => {
  if (!status) return 'error';

  if (status >= 500) return 'critical';
  if (status >= 400) return 'error';
  if (status >= 300) return 'warning';
  return 'info';
};

/**
 * Get error suggestions based on status and context
 */
const getErrorSuggestions = (
  status?: number,
  context?: ErrorContext,
  data?: ApiErrorResponse
): string[] => {
  const suggestions: string[] = [];

  switch (status) {
    case 400:
      suggestions.push('Check your input for errors');
      suggestions.push('Ensure all required fields are provided');
      break;
    case 401:
      suggestions.push('Sign in again to refresh your session');
      suggestions.push('Check that your account has the necessary permissions');
      break;
    case 403:
      suggestions.push('Contact your administrator for access');
      suggestions.push('Verify that you\'re using the correct account');
      break;
    case 404:
      suggestions.push('Check that the resource still exists');
      suggestions.push('Verify the URL or ID is correct');
      break;
    case 409:
      suggestions.push('Try using a different name');
      suggestions.push('Refresh the page to see the latest changes');
      break;
    case 413:
      suggestions.push('Reduce the file size or content length');
      suggestions.push('Break large templates into smaller pieces');
      break;
    case 429:
      suggestions.push('Wait a moment before trying again');
      suggestions.push('Reduce the frequency of requests');
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      suggestions.push('Try again in a few minutes');
      suggestions.push('Contact support if the problem persists');
      break;
  }

  // Add context-specific suggestions
  if (context === 'template' || context === 'snippet') {
    suggestions.push('Check the syntax highlighting for errors');
    suggestions.push('Validate your Handlebars syntax');
  }

  if (context === 'preview') {
    suggestions.push('Ensure all required data is provided');
    suggestions.push('Check that referenced snippets exist');
  }

  return suggestions;
};

/**
 * Format validation errors for display
 */
export const formatValidationErrors = (errors: ValidationError[]): Record<string, string> => {
  const formatted: Record<string, string> = {};

  errors.forEach(error => {
    formatted[error.field] = error.message;
  });

  return formatted;
};

/**
 * Check if error indicates a network issue
 */
export const isNetworkError = (error: any): boolean => {
  return (
    error?.code === 'NETWORK_ERROR' ||
    error?.message?.includes('Network Error') ||
    error?.code === 'ECONNABORTED' ||
    !error?.response
  );
};

/**
 * Check if error indicates an authentication issue
 */
export const isAuthError = (error: any): boolean => {
  return (
    error?.response?.status === 401 ||
    error?.response?.status === 403 ||
    error?.code === 'AUTH_ERROR'
  );
};

/**
 * Check if error indicates a validation issue
 */
export const isValidationError = (error: any): boolean => {
  return (
    error?.response?.status === 400 ||
    error?.response?.status === 422 ||
    error?.name === 'ValidationError' ||
    error?.code === 'VALIDATION_ERROR'
  );
};

/**
 * Create a standardized error object
 */
export const createError = (
  message: string,
  code?: string,
  details?: any
): Error & { code?: string; details?: any } => {
  const error = new Error(message) as Error & { code?: string; details?: any };
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
};

/**
 * Check if an error should be retried
 */
export const shouldRetryError = (error: any): boolean => {
  // Network errors should be retried
  if (isNetworkError(error)) {
    return true;
  }

  // Check HTTP status codes
  const status = error?.response?.status;
  return isRetryableError(status);
};

/**
 * Calculate retry delay with exponential backoff
 */
export const getRetryDelay = (attempt: number, baseDelay: number = 1000): number => {
  // Exponential backoff with jitter
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.1 * exponentialDelay; // Add up to 10% jitter
  return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
};

/**
 * Parse API error response
 */
export const parseApiError = (error: any): ApiErrorResponse => {
  if (error?.response?.data) {
    return error.response.data;
  }

  if (error?.message) {
    return {
      message: error.message,
      code: error.code
    };
  }

  return {
    message: 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR'
  };
};

/**
 * Retry function with exponential backoff
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on non-retryable errors
      if (!shouldRetryError(error)) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Wait with exponential backoff
      const delay = getRetryDelay(attempt + 1, baseDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};
