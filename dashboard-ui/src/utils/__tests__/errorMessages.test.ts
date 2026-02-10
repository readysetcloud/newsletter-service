import { describe, it, expect } from 'vitest';
import {
  getErrorDetails,
  getUserFriendlyErrorMessage,
  isRetryableError,
  validateAnalyticsData,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from '../errorMessages';

describe('Error Message Utilities', () => {
  describe('getErrorDetails', () => {
    it('should categorize 404 errors correctly', () => {
      const details = getErrorDetails('404 not found');
      expect(details.type).toBe('not_found');
      expect(details.title).toBe('Not Found');
      expect(details.showRetry).toBe(false);
      expect(details.showBackButton).toBe(true);
    });

    it('should categorize 403 errors correctly', () => {
      const details = getErrorDetails('403 Forbidden');
      expect(details.type).toBe('forbidden');
      expect(details.title).toBe('Access Denied');
      expect(details.showRetry).toBe(false);
    });

    it('should categorize 401 errors correctly', () => {
      const details = getErrorDetails('401 Unauthorized');
      expect(details.type).toBe('unauthorized');
      expect(details.title).toBe('Session Expired');
      expect(details.showRetry).toBe(false);
    });

    it('should categorize network errors correctly', () => {
      const details = getErrorDetails('Network error');
      expect(details.type).toBe('network');
      expect(details.title).toBe('Connection Error');
      expect(details.showRetry).toBe(true);
    });

    it('should categorize server errors correctly', () => {
      const details = getErrorDetails('500 Internal Server Error');
      expect(details.type).toBe('server');
      expect(details.title).toBe('Server Error');
      expect(details.showRetry).toBe(true);
    });

    it('should categorize timeout errors correctly', () => {
      const details = getErrorDetails('Request timed out');
      expect(details.type).toBe('timeout');
      expect(details.title).toBe('Request Timeout');
      expect(details.showRetry).toBe(true);
    });

    it('should handle unknown errors', () => {
      const details = getErrorDetails('Something went wrong');
      expect(details.type).toBe('unknown');
      expect(details.title).toBe('Error');
      expect(details.showRetry).toBe(true);
    });

    it('should handle Error objects', () => {
      const error = new Error('404 not found');
      const details = getErrorDetails(error);
      expect(details.type).toBe('not_found');
    });
  });

  describe('getUserFriendlyErrorMessage', () => {
    it('should return user-friendly message for 404', () => {
      const message = getUserFriendlyErrorMessage('404 not found');
      expect(message).toContain('could not be found');
    });

    it('should return user-friendly message for network errors', () => {
      const message = getUserFriendlyErrorMessage('Network error');
      expect(message).toContain('internet connection');
    });
  });

  describe('isRetryableError', () => {
    it('should return true for network errors', () => {
      expect(isRetryableError('Network error')).toBe(true);
    });

    it('should return true for server errors', () => {
      expect(isRetryableError('500 Server Error')).toBe(true);
    });

    it('should return false for 404 errors', () => {
      expect(isRetryableError('404 not found')).toBe(false);
    });

    it('should return false for 403 errors', () => {
      expect(isRetryableError('403 Forbidden')).toBe(false);
    });
  });

  describe('validateAnalyticsData', () => {
    it('should validate correct analytics data', () => {
      const analytics = {
        geoDistribution: [
          { country: 'US', opens: 100, clicks: 50 },
          { country: 'UK', opens: 80, clicks: 40 },
        ],
        links: [
          { url: 'https://example.com', clicks: 100 },
        ],
        deviceBreakdown: { desktop: 50, mobile: 30, tablet: 20 },
      };

      const result = validateAnalyticsData(analytics);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject null analytics', () => {
      const result = validateAnalyticsData(null);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Analytics data is missing');
    });

    it('should reject invalid geoDistribution', () => {
      const analytics = {
        geoDistribution: 'not an array',
      };

      const result = validateAnalyticsData(analytics);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Geographic distribution'))).toBe(true);
    });

    it('should reject invalid links', () => {
      const analytics = {
        links: 'not an array',
      };

      const result = validateAnalyticsData(analytics);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Link performance'))).toBe(true);
    });

    it('should reject invalid deviceBreakdown', () => {
      const analytics = {
        deviceBreakdown: 'not an object',
      };

      const result = validateAnalyticsData(analytics);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Device breakdown'))).toBe(true);
    });

    it('should reject invalid geo entries', () => {
      const analytics = {
        geoDistribution: [
          { country: 'US', opens: 'invalid', clicks: 50 },
        ],
      };

      const result = validateAnalyticsData(analytics);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('geographic data entries'))).toBe(true);
    });

    it('should reject invalid link entries', () => {
      const analytics = {
        links: [
          { url: '', clicks: 100 }, // Empty URL
        ],
      };

      const result = validateAnalyticsData(analytics);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('link performance entries'))).toBe(true);
    });
  });

  describe('safeLocalStorageGet', () => {
    it('should return default value when localStorage is unavailable', () => {
      const result = safeLocalStorageGet('nonexistent-key', { default: 'value' });
      expect(result).toEqual({ default: 'value' });
    });

    it('should return parsed value when available', () => {
      localStorage.setItem('test-key', JSON.stringify({ test: 'data' }));
      const result = safeLocalStorageGet('test-key', {});
      expect(result).toEqual({ test: 'data' });
      localStorage.removeItem('test-key');
    });
  });

  describe('safeLocalStorageSet', () => {
    it('should set value in localStorage', () => {
      const success = safeLocalStorageSet('test-key', { test: 'data' });
      expect(success).toBe(true);

      const stored = localStorage.getItem('test-key');
      expect(JSON.parse(stored!)).toEqual({ test: 'data' });

      localStorage.removeItem('test-key');
    });
  });
});
