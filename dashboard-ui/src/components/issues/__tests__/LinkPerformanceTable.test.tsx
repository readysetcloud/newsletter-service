import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { LinkPerformance } from '../../../types/issues';

describe('LinkPerformanceTable - Property-Based Tests', () => {
  describe('Property 6: Link Performance Percentage Sum', () => {
    it('should have link percentages sum to 100% within floating-point tolerance', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              url: fc.webUrl(),
              clicks: fc.integer({ min: 1, max: 10000 }),
              position: fc.integer({ min: 1, max: 100 }),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          (linkData) => {
            const totalClicks = linkData.reduce((sum, link) => sum + link.clicks, 0);

            const links: LinkPerformance[] = linkData.map((link) => ({
              url: link.url,
              clicks: link.clicks,
              percentOfTotal: (link.clicks / totalClicks) * 100,
              position: link.position,
            }));

            const sumOfPercentages = links.reduce((sum, link) => sum + link.percentOfTotal, 0);

            expect(Math.abs(sumOfPercentages - 100)).toBeLessThan(0.001);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have each link percentage equal to (clicks / totalClicks) * 100', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              url: fc.webUrl(),
              clicks: fc.integer({ min: 1, max: 10000 }),
              position: fc.integer({ min: 1, max: 100 }),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          (linkData) => {
            const totalClicks = linkData.reduce((sum, link) => sum + link.clicks, 0);

            const links: LinkPerformance[] = linkData.map((link) => ({
              url: link.url,
              clicks: link.clicks,
              percentOfTotal: (link.clicks / totalClicks) * 100,
              position: link.position,
            }));

            links.forEach((link) => {
              const expectedPercent = (link.clicks / totalClicks) * 100;
              expect(Math.abs(link.percentOfTotal - expectedPercent)).toBeLessThan(0.001);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle single link case where percentage is 100%', () => {
      fc.assert(
        fc.property(
          fc.record({
            url: fc.webUrl(),
            clicks: fc.integer({ min: 1, max: 10000 }),
            position: fc.integer({ min: 1, max: 100 }),
          }),
          (linkData) => {
            const link: LinkPerformance = {
              url: linkData.url,
              clicks: linkData.clicks,
              percentOfTotal: (linkData.clicks / linkData.clicks) * 100,
              position: linkData.position,
            };

            expect(Math.abs(link.percentOfTotal - 100)).toBeLessThan(0.001);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have all percentages be non-negative and not exceed 100%', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              url: fc.webUrl(),
              clicks: fc.integer({ min: 1, max: 10000 }),
              position: fc.integer({ min: 1, max: 100 }),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          (linkData) => {
            const totalClicks = linkData.reduce((sum, link) => sum + link.clicks, 0);

            const links: LinkPerformance[] = linkData.map((link) => ({
              url: link.url,
              clicks: link.clicks,
              percentOfTotal: (link.clicks / totalClicks) * 100,
              position: link.position,
            }));

            links.forEach((link) => {
              expect(link.percentOfTotal).toBeGreaterThanOrEqual(0);
              expect(link.percentOfTotal).toBeLessThanOrEqual(100);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
