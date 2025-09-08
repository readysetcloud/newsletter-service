import { describe, it, expect } from 'vitest';
import {
  getUserFriendlyErrorMessage,
  shouldRetryError,
  getRetryDelay,
  parseApiError,
  isNetworkError,
  isAuthError,
  isValidationError,
  getDetailedErrorInfo
} from '../errorHandling';

describe('Error Handling Utils', () => {
  describe('shouldRetryError', () => {
    it('should return true for network errors', () => {
      const networkError = { code: 'NETWORK_ERROR' };
      expect(shouldRetryError(networkError)).toBe(true);
    });

    it('should return true for retryable HTTP status codes', () => {
      const serverError = { response: { status: 500 } };
      expect(shouldRetryError(serverError)).toBe(true);

      const timeoutError = { response: { status: 408 } };
      expect(shouldRetryError(timeoutError)).toBe(true);

      const rateLimitError = { response: { status: 429 } };
      expect(shouldRetryError(rateLimitError)).toBe(true);
    });

    it('should return false for non-retryable HTTP status codes', () => {
      const badRequestError = { response: { status: 400 } };
      expect(shouldRetryError(badRequestError)).toBe(false);

      const unauthorizedError = { response: { status: 401 } };
      expect(shouldRetryError(unauthorizedError)).toBe(false);

      const notFoundError = { response: { status: 404 } };
      expect(shouldRetryError(notFoundError)).toBe(false);
    });
  });

  describe('getRetryDelay', () => {
    it('should calculate exponential backoff delay', () => {
      const baseDelay = 1000;

      const delay1 = getRetryDelay(1, baseDelay);
      expect(delay1).toBeGreaterThanOrEqual(baseDelay);
      expect(delay1).toBeLessThan(baseDelay * 1.2); // With jitter

      const delay2 = getRetryDelay(2, baseDelay);
      expect(delay2).toBeGreaterThanOrEqual(baseDelay * 2);
      expect(delay2).toBeLessThan(baseDelay * 2.2); // With jitter

      const delay3 = getRetryDelay(3, baseDelay);
      expect(delay3).toBeGreaterThanOrEqual(baseDelay * 4);
      expect(delay3).toBeLessThan(baseDelay * 4.4); // With jitter
    });

    it('should cap delay at 30 seconds', () => {
      const delay = getRetryDelay(10, 10000);
      expect(delay).toBeLessThanOrEqual(30000);
    });
  });

  describe('parseApiError', () => {
    it('should parse error from response data', () => {
      const error = {
        response: {
          data: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR'
          }
        }
      };

      const parsed = parseApiError(error);
      expect(parsed).toEqual({
        message: 'Validation failed',
        code: 'VALIDATION_ERROR'
      });
    });

    it('should parse error from error message', () => {
      const error = {
        message: 'Network error',
        code: 'NETWORK_ERROR'
      };

      const parsed = parseApiError(error);
      expect(parsed).toEqual({
        message: 'Network error',
        code: 'NETWORK_ERROR'
      });
    });

    it('should return default error for unknown errors', () => {
      const error = {};
      const parsed = parseApiError(error);

      expect(parsed).toEqual({
        message: 'An unexpected error occurred',
        code: 'UNKNOWN_ERROR'
      });
    });
  });

  describe('getUserFriendlyErrorMessage', () => {
    it('should return user-friendly message for network errors', () => {
      const networkError = { code: 'NETWORK_ERROR' };
      const message = getUserFriendlyErrorMessage(networkError);

      expect(message).toBe('Unable to connect to the server. Please check your internet connection and try again.');
    });

    it('should return user-friendly message for HTTP errors', () => {
      const unauthorizedError = {
        isAxiosError: true,
        response: { status: 401 }
      };

      const message = getUserFriendlyErrorMessage(unauthorizedError);
      expect(message).toBe('Your session has expired. Please sign in again.');
    });

    it('should return context-specific messages', () => {
      const error = { message: 'Template validation failed' };

      const templateMessage = getUserFriendlyErrorMessage(error, 'template');
      expect(templateMessage).toBe('The template contains syntax errors. Please check the highlighted issues and try again.');
    });
  });

  describe('isNetworkError', () => {
    it('should identify network errors', () => {
      expect(isNetworkError({ code: 'NETWORK_ERROR' })).toBe(true);
      expect(isNetworkError({ message: 'Network Error' })).toBe(true);
      expect(isNetworkError({ code: 'ECONNABORTED' })).toBe(true);
      expect(isNetworkError({})).toBe(true); // No response
    });

    it('should not identify non-network errors as network errors', () => {
      expect(isNetworkError({ response: { status: 400 } })).toBe(false);
    });
  });

  describe('isAuthError', () => {
    it('should identify authentication errors', () => {
      expect(isAuthError({ response: { status: 401 } })).toBe(true);
      expect(isAuthError({ response: { status: 403 } })).toBe(true);
      expect(isAuthError({ code: 'AUTH_ERROR' })).toBe(true);
    });

    it('should not identify non-auth errors as auth errors', () => {
      expect(isAuthError({ response: { status: 400 } })).toBe(false);
      expect(isAuthError({ response: { status: 500 } })).toBe(false);
    });
  });

  describe('isValidationError', () => {
    it('should identify validation errors', () => {
      expect(isValidationError({ response: { status: 400 } })).toBe(true);
      expect(isValidationError({ response: { status: 422 } })).toBe(true);
      expect(isValidationError({ name: 'ValidationError' })).toBe(true);
      expect(isValidationError({ code: 'VALIDATION_ERROR' })).toBe(true);
    });

    it('should not identify non-validation errors as validation errors', () => {
      expect(isValidationError({ response: { status: 500 } })).toBe(false);
      expect(isValidationError({ code: 'NETWORK_ERROR' })).toBe(false);
    });
  });

  describe('getDetailedErrorInfo', () => {
    it('should return detailed error information', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            errors: [
              { message: 'Name is required', line: 1 },
              { message: 'Invalid email format' }
            ]
          }
        }
      };

      const info = getDetailedErrorInfo(error, 'template');

      expect(info.message).toBe('Validation failed');
      expect(info.code).toBe('VALIDATION_ERROR');
      expect(info.severity).toBe('error');
      expect(info.retryable).toBe(false);
      expect(info.details).toEqual([
        'Line 1: Name is required',
        'Invalid email format'
      ]);
      expect(info.suggestions).toContain('Check your input for errors');
    });
  });
});
