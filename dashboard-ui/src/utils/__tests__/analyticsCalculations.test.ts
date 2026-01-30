import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  calculatePercentageDifference,
  calculateHealthStatus,
  calculateCompositeScore,
  calculateComplaintRate,
  isHighComplaintRate,
  type HealthThresholds,
} from '../analyticsCalculations';
import type { IssueMetrics } from '../../types/issues';

describe('Analytics Calculations - Property-Based Tests', () => {
  describe('Property 2: Trend Calculation Accuracy', () => {
    it('should calculate percentage difference accurately for any valid numbers', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0), max: Math.fround(10000), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }),
          (current, comparison) => {
            const result = calculatePercentageDifference(current, comparison);
            const expected = ((current - comparison) / comparison) * 100;

            expect(Math.abs(result - expected)).toBeLessThan(0.001);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return 100 when comparison is 0 and current is positive', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }),
          (current) => {
            const result = calculatePercentageDifference(current, 0);
            expect(result).toBe(100);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return 0 when both current and comparison are 0', () => {
      const result = calculatePercentageDifference(0, 0);
      expect(result).toBe(0);
    });
  });

  describe('Property 3: Trend Indicator Correctness', () => {
    it('should have direction matching sign of difference', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0), max: Math.fround(10000), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }),
          (current, previous) => {
            const percentChange = calculatePercentageDifference(current, previous);
            const difference = current - previous;

            if (Math.abs(difference) >= 0.1) {
              if (difference > 0) {
                expect(percentChange).toBeGreaterThan(0);
              } else if (difference < 0) {
                expect(percentChange).toBeLessThan(0);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate percentage change using the formula', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0), max: Math.fround(10000), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }),
          (current, previous) => {
            const result = calculatePercentageDifference(current, previous);
            const expected = ((current - previous) / previous) * 100;

            expect(Math.abs(result - expected)).toBeLessThan(0.001);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: Health Status Label Consistency', () => {
    it('should return Improving when current > average outside tolerance', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(10), max: Math.fround(100), noNaN: true }),
          fc.float({ min: Math.fround(5), max: Math.fround(20), noNaN: true }),
          fc.float({ min: Math.fround(10), max: Math.fround(50), noNaN: true }),
          (average, goodThreshold, warningThreshold) => {
            const current = average + 1;
            const thresholds: HealthThresholds = {
              good: goodThreshold,
              warning: warningThreshold,
            };

            const result = calculateHealthStatus(current, average, thresholds);

            expect(result.label).toBe('Improving');
            expect(result.status).toBe('healthy');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return Stable when current is within tolerance of average', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(10), max: Math.fround(100), noNaN: true }),
          fc.float({ min: Math.fround(5), max: Math.fround(20), noNaN: true }),
          fc.float({ min: Math.fround(10), max: Math.fround(50), noNaN: true }),
          (average, goodThreshold, warningThreshold) => {
            const current = average + 0.3;
            const thresholds: HealthThresholds = {
              good: goodThreshold,
              warning: warningThreshold,
            };

            const result = calculateHealthStatus(current, average, thresholds);

            expect(result.label).toBe('Stable');
            expect(result.status).toBe('healthy');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return Declining with appropriate status when current < average', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(20), max: Math.fround(100), noNaN: true }),
          (average) => {
            const current = average * 0.8;
            const thresholds: HealthThresholds = {
              good: 10,
              warning: 20,
            };

            const result = calculateHealthStatus(current, average, thresholds);

            expect(result.label).toBe('Declining');
            expect(['healthy', 'warning', 'critical']).toContain(result.status);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return critical status when decline exceeds warning threshold', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(50), max: Math.fround(100), noNaN: true }),
          (average) => {
            const current = average * 0.5;
            const thresholds: HealthThresholds = {
              good: 10,
              warning: 20,
            };

            const result = calculateHealthStatus(current, average, thresholds);

            expect(result.label).toBe('Declining');
            expect(result.status).toBe('critical');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 9: Comparison Calculation Accuracy', () => {
    it('should calculate comparison percentage using the formula', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }),
          (current, comparison) => {
            const result = calculatePercentageDifference(current, comparison);
            const expected = ((current - comparison) / comparison) * 100;

            expect(Math.abs(result - expected)).toBeLessThan(0.001);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case where comparison is zero', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          (current) => {
            const result = calculatePercentageDifference(current, 0);

            if (current > 0) {
              expect(result).toBe(100);
            } else {
              expect(result).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Composite Score Calculation', () => {
    it('should calculate composite score within valid range', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 100 }),
          (openRate, clickRate, bounceRate, delivered, opens, clicks, bounces, complaints) => {
            const metrics: IssueMetrics = {
              openRate,
              clickRate,
              bounceRate,
              delivered,
              opens,
              clicks,
              bounces,
              complaints,
            };

            const score = calculateCompositeScore(metrics);

            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return higher scores for better metrics', () => {
      const goodMetrics: IssueMetrics = {
        openRate: 80,
        clickRate: 40,
        bounceRate: 2,
        delivered: 1000,
        opens: 800,
        clicks: 400,
        bounces: 20,
        complaints: 1,
      };

      const poorMetrics: IssueMetrics = {
        openRate: 20,
        clickRate: 5,
        bounceRate: 15,
        delivered: 1000,
        opens: 200,
        clicks: 50,
        bounces: 150,
        complaints: 10,
      };

      const goodScore = calculateCompositeScore(goodMetrics);
      const poorScore = calculateCompositeScore(poorMetrics);

      expect(goodScore).toBeGreaterThan(poorScore);
    });

    it('should weight open rate and click rate equally at 40 percent each', () => {
      const highOpenRate: IssueMetrics = {
        openRate: 100,
        clickRate: 0,
        bounceRate: 0,
        delivered: 1000,
        opens: 1000,
        clicks: 0,
        bounces: 0,
        complaints: 0,
      };

      const highClickRate: IssueMetrics = {
        openRate: 0,
        clickRate: 100,
        bounceRate: 0,
        delivered: 1000,
        opens: 0,
        clicks: 1000,
        bounces: 0,
        complaints: 0,
      };

      const openScore = calculateCompositeScore(highOpenRate);
      const clickScore = calculateCompositeScore(highClickRate);

      expect(Math.abs(openScore - clickScore)).toBeLessThan(0.01);
    });
  });

  describe('Property 18: Complaint Rate Highlighting', () => {
    /**
     * Feature: issue-analytics-ui-split
     * Property 18: Complaint Rate Highlighting
     * Validates: Requirements 9.5
     *
     * This property verifies that complaint rates are correctly calculated
     * and highlighted when they exceed the threshold of 0.1%.
     */

    it('should calculate complaint rate accurately for any valid inputs', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 1, max: 100000 }),
          (complaints, deliveries) => {
            const rate = calculateComplaintRate(complaints, deliveries);
            const expected = (complaints / deliveries) * 100;

            expect(Math.abs(rate - expected)).toBeLessThan(0.0001);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return 0 when deliveries is 0', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }),
          (complaints) => {
            const rate = calculateComplaintRate(complaints, 0);
            expect(rate).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should highlight when complaint rate exceeds 0.1 percent threshold', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 100000 }),
          (deliveries) => {
            // Generate complaints that will exceed 0.1%
            const minComplaintsForHighRate = Math.ceil((deliveries * 0.1) / 100) + 1;

            // Ensure we have a valid range
            if (minComplaintsForHighRate > deliveries) {
              return true; // Skip this test case
            }

            const complaints = fc.sample(
              fc.integer({ min: minComplaintsForHighRate, max: deliveries }),
              1
            )[0];

            const rate = calculateComplaintRate(complaints, deliveries);
            const shouldHighlight = isHighComplaintRate(rate);

            expect(rate).toBeGreaterThan(0.1);
            expect(shouldHighlight).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not highlight when complaint rate is at or below 0.1 percent threshold', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 100000 }),
          (deliveries) => {
            // Generate complaints that will be at or below 0.1%
            const maxComplaintsForLowRate = Math.floor((deliveries * 0.1) / 100);
            const complaints = fc.sample(
              fc.integer({ min: 0, max: maxComplaintsForLowRate }),
              1
            )[0];

            const rate = calculateComplaintRate(complaints, deliveries);
            const shouldHighlight = isHighComplaintRate(rate);

            expect(rate).toBeLessThanOrEqual(0.1);
            expect(shouldHighlight).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use custom threshold when provided', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.01), max: Math.fround(5.0), noNaN: true }),
          fc.integer({ min: 1, max: 10000 }),
          (customThreshold, deliveries) => {
            const complaintsAbove = Math.ceil((deliveries * customThreshold) / 100) + 1;
            const complaintsBelow = Math.floor((deliveries * customThreshold) / 100);

            const rateAbove = calculateComplaintRate(complaintsAbove, deliveries);
            const rateBelow = calculateComplaintRate(complaintsBelow, deliveries);

            expect(isHighComplaintRate(rateAbove, customThreshold)).toBe(true);
            expect(isHighComplaintRate(rateBelow, customThreshold)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case of exactly 0.1 percent', () => {
      const deliveries = 1000;
      const complaints = 1; // Exactly 0.1%

      const rate = calculateComplaintRate(complaints, deliveries);
      const shouldHighlight = isHighComplaintRate(rate);

      expect(rate).toBe(0.1);
      expect(shouldHighlight).toBe(false); // Should not highlight at exactly threshold
    });

    it('should handle edge case of zero complaints', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100000 }),
          (deliveries) => {
            const rate = calculateComplaintRate(0, deliveries);
            const shouldHighlight = isHighComplaintRate(rate);

            expect(rate).toBe(0);
            expect(shouldHighlight).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle very small complaint rates correctly', () => {
      const deliveries = 1000000;
      const complaints = 1; // 0.0001%

      const rate = calculateComplaintRate(complaints, deliveries);
      const shouldHighlight = isHighComplaintRate(rate);

      expect(rate).toBeLessThan(0.1);
      expect(shouldHighlight).toBe(false);
    });

    it('should handle very high complaint rates correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 10000 }),
          (deliveries) => {
            const complaints = Math.floor(deliveries * 0.5); // 50% complaint rate

            const rate = calculateComplaintRate(complaints, deliveries);
            const shouldHighlight = isHighComplaintRate(rate);

            expect(rate).toBeGreaterThan(0.1);
            expect(shouldHighlight).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain consistency across multiple calculations', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 1, max: 100000 }),
          (complaints, deliveries) => {
            const rate1 = calculateComplaintRate(complaints, deliveries);
            const rate2 = calculateComplaintRate(complaints, deliveries);
            const highlight1 = isHighComplaintRate(rate1);
            const highlight2 = isHighComplaintRate(rate2);

            expect(rate1).toBe(rate2);
            expect(highlight1).toBe(highlight2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
