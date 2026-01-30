/**
 * Property-Based Tests: Data Validation Before Rendering
 *
 * Feature: issue-analytics-ui-split
 * Property 17: Data Validation Before Rendering
 * Validates: Requirements 7.5, 7.6
 *
 * These property tests verify that all data received from the backend API
 * is validated against TypeScript interfaces before rendering, rejecting invalid data.
 */

import { describe, it, expect } from 'vitest';
import {
  validateTrendsData,
  validateIssueStats,
  validateIssueAnalytics,
  validateIssueMetrics,
  validateTrendAggregates,
  validateIssueTrendItem,
  validateLinkPerformance,
  validateClickDecayPoint,
  validateGeoData,
  validateDeviceBreakdown,
  validateTimingMetrics,
  validateEngagementType,
  validateBounceReasons,
  validateComplaintDetail,
} from '../dataValidation';

describe('Property 17: Data Validation Before Rendering', () => {
  /**
   * Property: Valid data structures should pass validation
   */
  describe('Valid Data Acceptance', () => {
    it('should accept valid IssueMetrics', () => {
      const validMetrics = {
        openRate: 45.5,
        clickRate: 12.3,
        bounceRate: 2.1,
        delivered: 1000,
        opens: 455,
        clicks: 123,
        bounces: 21,
        complaints: 2,
      };

      expect(validateIssueMetrics(validMetrics)).toBe(true);
    });

    it('should accept valid TrendAggregates', () => {
      const validAggregates = {
        avgOpenRate: 45.5,
        avgClickRate: 12.3,
        avgBounceRate: 2.1,
        totalDelivered: 10000,
        issueCount: 10,
      };

      expect(validateTrendAggregates(validAggregates)).toBe(true);
    });

    it('should accept valid TrendsData', () => {
      const validTrendsData = {
        issues: [
          {
            id: '1',
            metrics: {
              openRate: 45.5,
              clickRate: 12.3,
              bounceRate: 2.1,
              delivered: 1000,
              opens: 455,
              clicks: 123,
              bounces: 21,
              complaints: 2,
            },
          },
        ],
        aggregates: {
          avgOpenRate: 45.5,
          avgClickRate: 12.3,
          avgBounceRate: 2.1,
          totalDelivered: 10000,
          issueCount: 10,
        },
      };

      expect(validateTrendsData(validTrendsData)).toBe(true);
    });

    it('should accept valid IssueStats', () => {
      const validStats = {
        opens: 455,
        clicks: 123,
        deliveries: 1000,
        bounces: 21,
        complaints: 2,
      };

      expect(validateIssueStats(validStats)).toBe(true);
    });

    it('should accept valid LinkPerformance', () => {
      const validLink = {
        url: 'https://example.com',
        clicks: 100,
        percentOfTotal: 50.0,
        position: 1,
      };

      expect(validateLinkPerformance(validLink)).toBe(true);
    });

    it('should accept valid DeviceBreakdown', () => {
      const validDevice = {
        desktop: 500,
        mobile: 400,
        tablet: 100,
      };

      expect(validateDeviceBreakdown(validDevice)).toBe(true);
    });
  });

  /**
   * Property: Invalid data structures should be rejected
   */
  describe('Invalid Data Rejection', () => {
    it('should reject IssueMetrics with negative values', () => {
      const invalidMetrics = {
        openRate: -5,
        clickRate: 12.3,
        bounceRate: 2.1,
        delivered: 1000,
        opens: 455,
        clicks: 123,
        bounces: 21,
        complaints: 2,
      };

      expect(validateIssueMetrics(invalidMetrics)).toBe(false);
    });

    it('should reject IssueMetrics with rates over 100', () => {
      const invalidMetrics = {
        openRate: 150,
        clickRate: 12.3,
        bounceRate: 2.1,
        delivered: 1000,
        opens: 455,
        clicks: 123,
        bounces: 21,
        complaints: 2,
      };

      expect(validateIssueMetrics(invalidMetrics)).toBe(false);
    });

    it('should reject IssueMetrics with NaN values', () => {
      const invalidMetrics = {
        openRate: NaN,
        clickRate: 12.3,
        bounceRate: 2.1,
        delivered: 1000,
        opens: 455,
        clicks: 123,
        bounces: 21,
        complaints: 2,
      };

      expect(validateIssueMetrics(invalidMetrics)).toBe(false);
    });

    it('should reject IssueMetrics with missing fields', () => {
      const invalidMetrics = {
        openRate: 45.5,
        clickRate: 12.3,
        // Missing bounceRate
        delivered: 1000,
        opens: 455,
        clicks: 123,
        bounces: 21,
        complaints: 2,
      };

      expect(validateIssueMetrics(invalidMetrics)).toBe(false);
    });

    it('should reject TrendsData with non-array issues', () => {
      const invalidTrendsData = {
        issues: 'not an array',
        aggregates: {
          avgOpenRate: 45.5,
          avgClickRate: 12.3,
          avgBounceRate: 2.1,
          totalDelivered: 10000,
          issueCount: 10,
        },
      };

      expect(validateTrendsData(invalidTrendsData)).toBe(false);
    });

    it('should reject TrendsData with invalid aggregates', () => {
      const invalidTrendsData = {
        issues: [],
        aggregates: {
          avgOpenRate: -5,
          avgClickRate: 12.3,
          avgBounceRate: 2.1,
          totalDelivered: 10000,
          issueCount: 10,
        },
      };

      expect(validateTrendsData(invalidTrendsData)).toBe(false);
    });

    it('should reject IssueStats with negative values', () => {
      const invalidStats = {
        opens: -1,
        clicks: 123,
        deliveries: 1000,
        bounces: 21,
        complaints: 2,
      };

      expect(validateIssueStats(invalidStats)).toBe(false);
    });

    it('should reject LinkPerformance with empty URL', () => {
      const invalidLink = {
        url: '',
        clicks: 100,
        percentOfTotal: 50.0,
        position: 1,
      };

      expect(validateLinkPerformance(invalidLink)).toBe(false);
    });

    it('should reject DeviceBreakdown with negative values', () => {
      const invalidDevice = {
        desktop: -1,
        mobile: 400,
        tablet: 100,
      };

      expect(validateDeviceBreakdown(invalidDevice)).toBe(false);
    });
  });

  /**
   * Property: Type mismatches should be rejected
   */
  describe('Type Mismatch Rejection', () => {
    it('should reject IssueMetrics with string values', () => {
      const invalidMetrics = {
        openRate: '45.5',
        clickRate: 12.3,
        bounceRate: 2.1,
        delivered: 1000,
        opens: 455,
        clicks: 123,
        bounces: 21,
        complaints: 2,
      };

      expect(validateIssueMetrics(invalidMetrics)).toBe(false);
    });

    it('should reject TrendAggregates with boolean values', () => {
      const invalidAggregates = {
        avgOpenRate: true,
        avgClickRate: 12.3,
        avgBounceRate: 2.1,
        totalDelivered: 10000,
        issueCount: 10,
      };

      expect(validateTrendAggregates(invalidAggregates)).toBe(false);
    });

    it('should reject IssueTrendItem with numeric id', () => {
      const invalidItem = {
        id: 123,
        metrics: {
          openRate: 45.5,
          clickRate: 12.3,
          bounceRate: 2.1,
          delivered: 1000,
          opens: 455,
          clicks: 123,
          bounces: 21,
          complaints: 2,
        },
      };

      expect(validateIssueTrendItem(invalidItem)).toBe(false);
    });

    it('should reject LinkPerformance with numeric URL', () => {
      const invalidLink = {
        url: 12345,
        clicks: 100,
        percentOfTotal: 50.0,
        position: 1,
      };

      expect(validateLinkPerformance(invalidLink)).toBe(false);
    });
  });

  /**
   * Property: Null and undefined values should be handled correctly
   */
  describe('Null and Undefined Handling', () => {
    it('should reject null as IssueMetrics', () => {
      expect(validateIssueMetrics(null)).toBe(false);
    });

    it('should reject undefined as IssueMetrics', () => {
      expect(validateIssueMetrics(undefined)).toBe(false);
    });

    it('should reject null as TrendsData', () => {
      expect(validateTrendsData(null)).toBe(false);
    });

    it('should reject undefined as TrendsData', () => {
      expect(validateTrendsData(undefined)).toBe(false);
    });

    it('should accept IssueStats without optional analytics', () => {
      const validStats = {
        opens: 455,
        clicks: 123,
        deliveries: 1000,
        bounces: 21,
        complaints: 2,
        analytics: undefined,
      };

      expect(validateIssueStats(validStats)).toBe(true);
    });

    it('should accept TrendsData without optional previousPeriodAggregates', () => {
      const validTrendsData = {
        issues: [],
        aggregates: {
          avgOpenRate: 45.5,
          avgClickRate: 12.3,
          avgBounceRate: 2.1,
          totalDelivered: 10000,
          issueCount: 10,
        },
        previousPeriodAggregates: undefined,
      };

      expect(validateTrendsData(validTrendsData)).toBe(true);
    });
  });

  /**
   * Property: Analytics data validation

   */
  describe('Analytics Data Validation', () => {
    it('should accept valid IssueAnalytics', () => {
      const validAnalytics = {
        links: [
          {
            url: 'https://example.com',
            clicks: 100,
            percentOfTotal: 50.0,
            position: 1,
          },
        ],
        clickDecay: [
          {
            hour: 0,
            clicks: 50,
            cumulativeClicks: 50,
          },
        ],
        geoDistribution: [
          {
            country: 'US',
            clicks: 100,
            opens: 200,
          },
        ],
        deviceBreakdown: {
          desktop: 500,
          mobile: 400,
          tablet: 100,
        },
        timingMetrics: {
          medianTimeToOpen: 3600,
          p95TimeToOpen: 86400,
          medianTimeToClick: 7200,
          p95TimeToClick: 172800,
        },
        engagementType: {
          newClickers: 50,
          returningClickers: 50,
        },
        bounceReasons: {
          permanent: 10,
          temporary: 5,
          suppressed: 2,
        },
        complaintDetails: [
          {
            email: 'user@example.com',
            timestamp: '2025-01-15T10:00:00Z',
            complaintType: 'spam',
          },
        ],
      };

      expect(validateIssueAnalytics(validAnalytics)).toBe(true);
    });

    it('should reject IssueAnalytics with invalid links', () => {
      const invalidAnalytics = {
        links: [
          {
            url: '',
            clicks: 100,
            percentOfTotal: 50.0,
            position: 1,
          },
        ],
        clickDecay: [],
        geoDistribution: [],
        deviceBreakdown: {
          desktop: 500,
          mobile: 400,
          tablet: 100,
        },
        timingMetrics: {
          medianTimeToOpen: 3600,
          p95TimeToOpen: 86400,
          medianTimeToClick: 7200,
          p95TimeToClick: 172800,
        },
        engagementType: {
          newClickers: 50,
          returningClickers: 50,
        },
        bounceReasons: {
          permanent: 10,
          temporary: 5,
          suppressed: 2,
        },
        complaintDetails: [],
      };

      expect(validateIssueAnalytics(invalidAnalytics)).toBe(false);
    });

    it('should reject IssueAnalytics with invalid clickDecay', () => {
      const invalidAnalytics = {
        links: [],
        clickDecay: [
          {
            hour: -1,
            clicks: 50,
            cumulativeClicks: 50,
          },
        ],
        geoDistribution: [],
        deviceBreakdown: {
          desktop: 500,
          mobile: 400,
          tablet: 100,
        },
        timingMetrics: {
          medianTimeToOpen: 3600,
          p95TimeToOpen: 86400,
          medianTimeToClick: 7200,
          p95TimeToClick: 172800,
        },
        engagementType: {
          newClickers: 50,
          returningClickers: 50,
        },
        bounceReasons: {
          permanent: 10,
          temporary: 5,
          suppressed: 2,
        },
        complaintDetails: [],
      };

      expect(validateIssueAnalytics(invalidAnalytics)).toBe(false);
    });
  });

  /**
   * Property: Edge cases should be handled correctly
   */
  describe('Edge Case Handling', () => {
    it('should accept zero values for metrics', () => {
      const zeroMetrics = {
        openRate: 0,
        clickRate: 0,
        bounceRate: 0,
        delivered: 0,
        opens: 0,
        clicks: 0,
        bounces: 0,
        complaints: 0,
      };

      expect(validateIssueMetrics(zeroMetrics)).toBe(true);
    });

    it('should accept 100% rates', () => {
      const maxRateMetrics = {
        openRate: 100,
        clickRate: 100,
        bounceRate: 100,
        delivered: 1000,
        opens: 1000,
        clicks: 1000,
        bounces: 1000,
        complaints: 0,
      };

      expect(validateIssueMetrics(maxRateMetrics)).toBe(true);
    });

    it('should accept empty arrays in TrendsData', () => {
      const emptyTrendsData = {
        issues: [],
        aggregates: {
          avgOpenRate: 0,
          avgClickRate: 0,
          avgBounceRate: 0,
          totalDelivered: 0,
          issueCount: 0,
        },
      };

      expect(validateTrendsData(emptyTrendsData)).toBe(true);
    });

    it('should accept empty arrays in IssueAnalytics', () => {
      const emptyAnalytics = {
        links: [],
        clickDecay: [],
        geoDistribution: [],
        deviceBreakdown: {
          desktop: 0,
          mobile: 0,
          tablet: 0,
        },
        timingMetrics: {
          medianTimeToOpen: 0,
          p95TimeToOpen: 0,
          medianTimeToClick: 0,
          p95TimeToClick: 0,
        },
        engagementType: {
          newClickers: 0,
          returningClickers: 0,
        },
        bounceReasons: {
          permanent: 0,
          temporary: 0,
          suppressed: 0,
        },
        complaintDetails: [],
      };

      expect(validateIssueAnalytics(emptyAnalytics)).toBe(true);
    });
  });

  /**
   * Property: Validation should prevent rendering of invalid data
   */
  describe('Rendering Prevention', () => {
    it('should prevent rendering when TrendsData validation fails', () => {
      const invalidData = {
        issues: 'not an array',
        aggregates: null,
      };

      const isValid = validateTrendsData(invalidData);

      // Property: Invalid data should not be rendered
      expect(isValid).toBe(false);
    });

    it('should prevent rendering when IssueStats validation fails', () => {
      const invalidData = {
        opens: -1,
        clicks: 'invalid',
        deliveries: null,
        bounces: undefined,
        complaints: NaN,
      };

      const isValid = validateIssueStats(invalidData);

      // Property: Invalid data should not be rendered
      expect(isValid).toBe(false);
    });

    it('should allow rendering only when validation passes', () => {
      const validData = {
        opens: 100,
        clicks: 50,
        deliveries: 1000,
        bounces: 10,
        complaints: 1,
      };

      const isValid = validateIssueStats(validData);

      // Property: Valid data should be allowed to render
      expect(isValid).toBe(true);
    });
  });
});
