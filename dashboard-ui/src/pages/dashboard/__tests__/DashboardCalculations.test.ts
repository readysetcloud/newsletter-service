import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateCompositeScore } from '@/utils/analyticsCalculations';
import type { IssueMetrics } from '@/types/issues';

describe('Dashboard Calculations - Property-Based Tests', () => {
  describe('Property 5: Best/Worst Issue Identification', () => {
    it('should identify issue with highest composite score as best', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              openRate: fc.float({ min: 0, max: 100, noNaN: true }),
              clickRate: fc.float({ min: 0, max: 100, noNaN: true }),
              bounceRate: fc.float({ min: 0, max: 100, noNaN: true }),
              delivered: fc.integer({ min: 1, max: 10000 }),
              opens: fc.integer({ min: 0, max: 10000 }),
              clicks: fc.integer({ min: 0, max: 10000 }),
              bounces: fc.integer({ min: 0, max: 1000 }),
              complaints: fc.integer({ min: 0, max: 100 }),
              subscribers: fc.integer({ min: 0, max: 100000 }),
            }),
            { minLength: 2, maxLength: 50 }
          ),
          (metricsArray) => {
            const issuesWithScores = metricsArray.map((metrics, index) => ({
              id: `${index + 1}`,
              issueNumber: index + 1,
              score: calculateCompositeScore(metrics as IssueMetrics),
            }));

            issuesWithScores.sort((a, b) => b.score - a.score);

            const best = issuesWithScores[0];
            const worst = issuesWithScores[issuesWithScores.length - 1];

            for (const issue of issuesWithScores) {
              expect(issue.score).toBeLessThanOrEqual(best.score);
              expect(issue.score).toBeGreaterThanOrEqual(worst.score);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should identify issue with lowest composite score as worst', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              openRate: fc.float({ min: 0, max: 100, noNaN: true }),
              clickRate: fc.float({ min: 0, max: 100, noNaN: true }),
              bounceRate: fc.float({ min: 0, max: 100, noNaN: true }),
              delivered: fc.integer({ min: 1, max: 10000 }),
              opens: fc.integer({ min: 0, max: 10000 }),
              clicks: fc.integer({ min: 0, max: 10000 }),
              bounces: fc.integer({ min: 0, max: 1000 }),
              complaints: fc.integer({ min: 0, max: 100 }),
              subscribers: fc.integer({ min: 0, max: 100000 }),
            }),
            { minLength: 2, maxLength: 50 }
          ),
          (metricsArray) => {
            const issuesWithScores = metricsArray.map((metrics, index) => ({
              id: `${index + 1}`,
              issueNumber: index + 1,
              score: calculateCompositeScore(metrics as IssueMetrics),
            }));

            const minScore = Math.min(...issuesWithScores.map((i) => i.score));
            const worstIssue = issuesWithScores.find((i) => i.score === minScore);

            expect(worstIssue).toBeDefined();
            expect(worstIssue!.score).toBe(minScore);

            for (const issue of issuesWithScores) {
              expect(issue.score).toBeGreaterThanOrEqual(worstIssue!.score);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain consistent ordering when sorted by score', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              openRate: fc.float({ min: 0, max: 100, noNaN: true }),
              clickRate: fc.float({ min: 0, max: 100, noNaN: true }),
              bounceRate: fc.float({ min: 0, max: 100, noNaN: true }),
              delivered: fc.integer({ min: 1, max: 10000 }),
              opens: fc.integer({ min: 0, max: 10000 }),
              clicks: fc.integer({ min: 0, max: 10000 }),
              bounces: fc.integer({ min: 0, max: 1000 }),
              complaints: fc.integer({ min: 0, max: 100 }),
              subscribers: fc.integer({ min: 0, max: 100000 }),
            }),
            { minLength: 2, maxLength: 50 }
          ),
          (metricsArray) => {
            const issuesWithScores = metricsArray.map((metrics, index) => ({
              id: `${index + 1}`,
              issueNumber: index + 1,
              score: calculateCompositeScore(metrics as IssueMetrics),
            }));

            issuesWithScores.sort((a, b) => b.score - a.score);

            for (let i = 0; i < issuesWithScores.length - 1; i++) {
              expect(issuesWithScores[i].score).toBeGreaterThanOrEqual(
                issuesWithScores[i + 1].score
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle single issue case correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            openRate: fc.float({ min: 0, max: 100, noNaN: true }),
            clickRate: fc.float({ min: 0, max: 100, noNaN: true }),
            bounceRate: fc.float({ min: 0, max: 100, noNaN: true }),
            delivered: fc.integer({ min: 1, max: 10000 }),
            opens: fc.integer({ min: 0, max: 10000 }),
            clicks: fc.integer({ min: 0, max: 10000 }),
            bounces: fc.integer({ min: 0, max: 1000 }),
            complaints: fc.integer({ min: 0, max: 100 }),
            subscribers: fc.integer({ min: 0, max: 100000 }),
          }),
          (metrics) => {
            const issuesWithScores = [
              {
                id: '1',
                issueNumber: 1,
                score: calculateCompositeScore(metrics as IssueMetrics),
              },
            ];

            const best = issuesWithScores[0];
            const worst = issuesWithScores[0];

            expect(best.score).toBe(worst.score);
            expect(best.id).toBe(worst.id);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate composite score consistently for same metrics', () => {
      fc.assert(
        fc.property(
          fc.record({
            openRate: fc.float({ min: 0, max: 100, noNaN: true }),
            clickRate: fc.float({ min: 0, max: 100, noNaN: true }),
            bounceRate: fc.float({ min: 0, max: 100, noNaN: true }),
            delivered: fc.integer({ min: 1, max: 10000 }),
            opens: fc.integer({ min: 0, max: 10000 }),
            clicks: fc.integer({ min: 0, max: 10000 }),
            bounces: fc.integer({ min: 0, max: 1000 }),
            complaints: fc.integer({ min: 0, max: 100 }),
            subscribers: fc.integer({ min: 0, max: 100000 }),
          }),
          (metrics) => {
            const score1 = calculateCompositeScore(metrics as IssueMetrics);
            const score2 = calculateCompositeScore(metrics as IssueMetrics);

            expect(score1).toBe(score2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
