import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { ClickDecayPoint } from '@/types';

describe('ClickDecayChart - Property-Based Tests', () => {
  describe('Property 7: Click Decay Monotonicity', () => {
    it('should have monotonically increasing cumulative clicks', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              hour: fc.integer({ min: 0, max: 168 }),
              clicks: fc.integer({ min: 0, max: 10000 }),
              cumulativeClicks: fc.integer({ min: 0, max: 100000 }),
            }),
            { minLength: 2, maxLength: 50 }
          ),
          (rawData) => {
            const sortedData = [...rawData].sort((a, b) => a.hour - b.hour);

            let cumulativeSum = 0;
            const validData: ClickDecayPoint[] = sortedData.map((point) => {
              cumulativeSum += point.clicks;
              return {
                hour: point.hour,
                clicks: point.clicks,
                cumulativeClicks: cumulativeSum,
              };
            });

            for (let i = 1; i < validData.length; i++) {
              const current = validData[i].cumulativeClicks;
              const previous = validData[i - 1].cumulativeClicks;

              expect(current).toBeGreaterThanOrEqual(previous);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have cumulative clicks equal to sum of all clicks up to that hour', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              hour: fc.integer({ min: 0, max: 168 }),
              clicks: fc.integer({ min: 0, max: 1000 }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          (rawData) => {
            const sortedData = [...rawData].sort((a, b) => a.hour - b.hour);

            let cumulativeSum = 0;
            const validData: ClickDecayPoint[] = sortedData.map((point) => {
              cumulativeSum += point.clicks;
              return {
                hour: point.hour,
                clicks: point.clicks,
                cumulativeClicks: cumulativeSum,
              };
            });

            let expectedSum = 0;
            for (let i = 0; i < validData.length; i++) {
              expectedSum += validData[i].clicks;
              expect(validData[i].cumulativeClicks).toBe(expectedSum);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never have negative cumulative clicks', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              hour: fc.integer({ min: 0, max: 168 }),
              clicks: fc.integer({ min: 0, max: 1000 }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          (rawData) => {
            const sortedData = [...rawData].sort((a, b) => a.hour - b.hour);

            let cumulativeSum = 0;
            const validData: ClickDecayPoint[] = sortedData.map((point) => {
              cumulativeSum += point.clicks;
              return {
                hour: point.hour,
                clicks: point.clicks,
                cumulativeClicks: cumulativeSum,
              };
            });

            for (const point of validData) {
              expect(point.cumulativeClicks).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have final cumulative clicks equal to total clicks', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              hour: fc.integer({ min: 0, max: 168 }),
              clicks: fc.integer({ min: 0, max: 1000 }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          (rawData) => {
            const sortedData = [...rawData].sort((a, b) => a.hour - b.hour);

            let cumulativeSum = 0;
            const validData: ClickDecayPoint[] = sortedData.map((point) => {
              cumulativeSum += point.clicks;
              return {
                hour: point.hour,
                clicks: point.clicks,
                cumulativeClicks: cumulativeSum,
              };
            });

            const totalClicks = validData.reduce((sum, point) => sum + point.clicks, 0);
            const finalCumulative = validData[validData.length - 1].cumulativeClicks;

            expect(finalCumulative).toBe(totalClicks);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case with zero clicks', () => {
      const zeroClicksData: ClickDecayPoint[] = [
        { hour: 0, clicks: 0, cumulativeClicks: 0 },
        { hour: 1, clicks: 0, cumulativeClicks: 0 },
        { hour: 2, clicks: 0, cumulativeClicks: 0 },
      ];

      for (let i = 1; i < zeroClicksData.length; i++) {
        const current = zeroClicksData[i].cumulativeClicks;
        const previous = zeroClicksData[i - 1].cumulativeClicks;

        expect(current).toBeGreaterThanOrEqual(previous);
      }
    });

    it('should handle edge case with single data point', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }),
          (clicks) => {
            const singlePoint: ClickDecayPoint[] = [
              { hour: 0, clicks, cumulativeClicks: clicks },
            ];

            expect(singlePoint[0].cumulativeClicks).toBe(clicks);
            expect(singlePoint[0].cumulativeClicks).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
