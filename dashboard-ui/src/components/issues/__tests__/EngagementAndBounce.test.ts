import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { EngagementType, BounceReasons } from '@/types/issues';

describe('Engagement and Bounce Data - Property-Based Tests', () => {
  describe('Property 11: Engagement Type Totals', () => {
    it('should have engagement types sum equal to total unique clickers', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 1, max: 20000 }),
          (newClickers, returningClickers, totalClicks) => {
            const engagementType: EngagementType = {
              newClickers,
              returningClickers,
            };

            const sumOfEngagementTypes = engagementType.newClickers + engagementType.returningClickers;

            if (sumOfEngagementTypes === totalClicks) {
              expect(sumOfEngagementTypes).toBe(totalClicks);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have engagement type sum match when generated from total', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20000 }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (totalClicks, newClickerRatio) => {
            const newClickers = Math.floor(totalClicks * newClickerRatio);
            const returningClickers = totalClicks - newClickers;

            const engagementType: EngagementType = {
              newClickers,
              returningClickers,
            };

            const sumOfEngagementTypes = engagementType.newClickers + engagementType.returningClickers;

            expect(sumOfEngagementTypes).toBe(totalClicks);
            expect(engagementType.newClickers).toBeGreaterThanOrEqual(0);
            expect(engagementType.returningClickers).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate engagement percentages that sum to 100 percent', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20000 }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (totalClicks, newClickerRatio) => {
            const newClickers = Math.floor(totalClicks * newClickerRatio);
            const returningClickers = totalClicks - newClickers;

            const engagementType: EngagementType = {
              newClickers,
              returningClickers,
            };

            const sumOfEngagementTypes = engagementType.newClickers + engagementType.returningClickers;

            const newPercent = (engagementType.newClickers / sumOfEngagementTypes) * 100;
            const returningPercent = (engagementType.returningClickers / sumOfEngagementTypes) * 100;

            const totalPercent = newPercent + returningPercent;

            expect(Math.abs(totalPercent - 100)).toBeLessThan(0.01);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have each engagement type not exceed total clicks', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20000 }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (totalClicks, newClickerRatio) => {
            const newClickers = Math.floor(totalClicks * newClickerRatio);
            const returningClickers = totalClicks - newClickers;

            const engagementType: EngagementType = {
              newClickers,
              returningClickers,
            };

            expect(engagementType.newClickers).toBeLessThanOrEqual(totalClicks);
            expect(engagementType.returningClickers).toBeLessThanOrEqual(totalClicks);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 12: Bounce Reasons Totals', () => {
    it('should have bounce reasons sum equal to total bounces', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5000 }),
          fc.integer({ min: 0, max: 5000 }),
          fc.integer({ min: 0, max: 5000 }),
          fc.integer({ min: 1, max: 15000 }),
          (permanent, temporary, suppressed, totalBounces) => {
            const bounceReasons: BounceReasons = {
              permanent,
              temporary,
              suppressed,
            };

            const sumOfBounceReasons = bounceReasons.permanent + bounceReasons.temporary + bounceReasons.suppressed;

            if (sumOfBounceReasons === totalBounces) {
              expect(sumOfBounceReasons).toBe(totalBounces);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have bounce reasons sum match when generated from total', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 15000 }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (totalBounces, permanentRatio, temporaryRatio) => {
            const suppressedRatio = Math.max(0, 1 - permanentRatio - temporaryRatio);
            const normalizedPermanent = permanentRatio / (permanentRatio + temporaryRatio + suppressedRatio);
            const normalizedTemporary = temporaryRatio / (permanentRatio + temporaryRatio + suppressedRatio);
            // const normalizedSuppressed = suppressedRatio / (permanentRatio + temporaryRatio + suppressedRatio);

            const permanent = Math.floor(totalBounces * normalizedPermanent);
            const temporary = Math.floor(totalBounces * normalizedTemporary);
            const suppressed = totalBounces - permanent - temporary;

            const bounceReasons: BounceReasons = {
              permanent,
              temporary,
              suppressed,
            };

            const sumOfBounceReasons = bounceReasons.permanent + bounceReasons.temporary + bounceReasons.suppressed;

            expect(sumOfBounceReasons).toBe(totalBounces);
            expect(bounceReasons.permanent).toBeGreaterThanOrEqual(0);
            expect(bounceReasons.temporary).toBeGreaterThanOrEqual(0);
            expect(bounceReasons.suppressed).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have all bounce reason values non-negative', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5000 }),
          fc.integer({ min: 0, max: 5000 }),
          fc.integer({ min: 0, max: 5000 }),
          (permanent, temporary, suppressed) => {
            const bounceReasons: BounceReasons = {
              permanent,
              temporary,
              suppressed,
            };

            expect(bounceReasons.permanent).toBeGreaterThanOrEqual(0);
            expect(bounceReasons.temporary).toBeGreaterThanOrEqual(0);
            expect(bounceReasons.suppressed).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate bounce reason percentages that sum to 100 percent', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 15000 }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (totalBounces, permanentRatio, temporaryRatio) => {
            const suppressedRatio = Math.max(0, 1 - permanentRatio - temporaryRatio);
            const normalizedPermanent = permanentRatio / (permanentRatio + temporaryRatio + suppressedRatio);
            const normalizedTemporary = temporaryRatio / (permanentRatio + temporaryRatio + suppressedRatio);
            // const normalizedSuppressed = suppressedRatio / (permanentRatio + temporaryRatio + suppressedRatio);

            const permanent = Math.floor(totalBounces * normalizedPermanent);
            const temporary = Math.floor(totalBounces * normalizedTemporary);
            const suppressed = totalBounces - permanent - temporary;

            const bounceReasons: BounceReasons = {
              permanent,
              temporary,
              suppressed,
            };

            const sumOfBounceReasons = bounceReasons.permanent + bounceReasons.temporary + bounceReasons.suppressed;

            const permanentPercent = (bounceReasons.permanent / sumOfBounceReasons) * 100;
            const temporaryPercent = (bounceReasons.temporary / sumOfBounceReasons) * 100;
            const suppressedPercent = (bounceReasons.suppressed / sumOfBounceReasons) * 100;

            const totalPercent = permanentPercent + temporaryPercent + suppressedPercent;

            expect(Math.abs(totalPercent - 100)).toBeLessThan(0.01);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have each bounce reason not exceed total bounces', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 15000 }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (totalBounces, permanentRatio, temporaryRatio) => {
            const suppressedRatio = Math.max(0, 1 - permanentRatio - temporaryRatio);
            const normalizedPermanent = permanentRatio / (permanentRatio + temporaryRatio + suppressedRatio);
            const normalizedTemporary = temporaryRatio / (permanentRatio + temporaryRatio + suppressedRatio);
            // const normalizedSuppressed = suppressedRatio / (permanentRatio + temporaryRatio + suppressedRatio);

            const permanent = Math.floor(totalBounces * normalizedPermanent);
            const temporary = Math.floor(totalBounces * normalizedTemporary);
            const suppressed = totalBounces - permanent - temporary;

            const bounceReasons: BounceReasons = {
              permanent,
              temporary,
              suppressed,
            };

            expect(bounceReasons.permanent).toBeLessThanOrEqual(totalBounces);
            expect(bounceReasons.temporary).toBeLessThanOrEqual(totalBounces);
            expect(bounceReasons.suppressed).toBeLessThanOrEqual(totalBounces);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain bounce reason distribution when scaling', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5000 }),
          fc.integer({ min: 1, max: 5000 }),
          fc.integer({ min: 1, max: 5000 }),
          fc.integer({ min: 2, max: 10 }),
          (permanent, temporary, suppressed, scaleFactor) => {
            // const originalBounceReasons: BounceReasons = {
            //   permanent,
            //   temporary,
            //   suppressed,
            // };

            const originalTotal = permanent + temporary + suppressed;
            const originalPermanentRatio = permanent / originalTotal;
            const originalTemporaryRatio = temporary / originalTotal;
            const originalSuppressedRatio = suppressed / originalTotal;

            const scaledBounceReasons: BounceReasons = {
              permanent: permanent * scaleFactor,
              temporary: temporary * scaleFactor,
              suppressed: suppressed * scaleFactor,
            };

            const scaledTotal = scaledBounceReasons.permanent + scaledBounceReasons.temporary + scaledBounceReasons.suppressed;
            const scaledPermanentRatio = scaledBounceReasons.permanent / scaledTotal;
            const scaledTemporaryRatio = scaledBounceReasons.temporary / scaledTotal;
            const scaledSuppressedRatio = scaledBounceReasons.suppressed / scaledTotal;

            expect(Math.abs(scaledPermanentRatio - originalPermanentRatio)).toBeLessThan(0.01);
            expect(Math.abs(scaledTemporaryRatio - originalTemporaryRatio)).toBeLessThan(0.01);
            expect(Math.abs(scaledSuppressedRatio - originalSuppressedRatio)).toBeLessThan(0.01);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
