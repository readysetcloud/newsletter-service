import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getSortedInterestProfile } from '../interestProfileUtils';
import type { InterestScoreEntry } from '@/services/segmentService';

/**
 * Feature: auto-interest-segmentation
 * Property 13: Interest profile is sorted by score descending
 *
 * For any subscriber with N > 0 interest score entries, the displayed interest
 * profile must be sorted by score value in descending order (highest first),
 * and topics with zero score must be omitted.
 *
 * **Validates: Requirements 8.4**
 */

const VALID_TOPICS = [
  'ai', 'serverless', 'eda', 'devops', 'security',
  'frontend', 'databases', 'career', 'cloud', 'apis',
  'testing', 'observability',
];

const TOPIC_DISPLAY_NAMES: Record<string, string> = {
  ai: 'AI',
  serverless: 'Serverless',
  eda: 'Event-Driven Architecture',
  devops: 'DevOps',
  security: 'Security',
  frontend: 'Frontend',
  databases: 'Databases',
  career: 'Career',
  cloud: 'Cloud',
  apis: 'APIs',
  testing: 'Testing',
  observability: 'Observability',
};

/** Arbitrary for a random ISO 8601 timestamp within the last 60 days */
const now = Date.now();
const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
const isoTimestampArb = fc
  .integer({ min: now - sixtyDaysMs, max: now })
  .map(ms => new Date(ms).toISOString());

/** Arbitrary for a random interest score (including zero to test filtering) */
const scoreArb = fc.oneof(
  fc.constant(0),
  fc.float({ min: 0, max: 50, noNaN: true }),
);

/** Arbitrary for a random interestScores map with 1-12 topics */
const interestScoresArb = fc
  .shuffledSubarray(VALID_TOPICS, { minLength: 1, maxLength: VALID_TOPICS.length })
  .chain(topics =>
    fc.tuple(
      ...topics.map(() => fc.tuple(scoreArb, isoTimestampArb))
    ).map(entries => {
      const scores: Record<string, InterestScoreEntry> = {};
      topics.forEach((topic, i) => {
        scores[topic] = {
          score: entries[i][0],
          lastScoredAt: entries[i][1],
        };
      });
      return scores;
    })
  );

describe('Property 13: Interest profile is sorted by score descending', () => {
  it('output is sorted by score descending', () => {
    fc.assert(
      fc.property(interestScoresArb, (interestScores) => {
        const result = getSortedInterestProfile(interestScores);

        for (let i = 1; i < result.length; i++) {
          expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('no entries with zero score appear in the output', () => {
    fc.assert(
      fc.property(interestScoresArb, (interestScores) => {
        const result = getSortedInterestProfile(interestScores);

        for (const entry of result) {
          expect(entry.score).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all entries have valid topic labels and display names', () => {
    fc.assert(
      fc.property(interestScoresArb, (interestScores) => {
        const result = getSortedInterestProfile(interestScores);

        for (const entry of result) {
          expect(VALID_TOPICS).toContain(entry.topic);
          expect(entry.displayName).toBe(TOPIC_DISPLAY_NAMES[entry.topic]);
          expect(entry.displayName.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all non-zero entries from input are preserved in output', () => {
    fc.assert(
      fc.property(interestScoresArb, (interestScores) => {
        const result = getSortedInterestProfile(interestScores);
        const nonZeroInputCount = Object.values(interestScores).filter(e => e.score > 0).length;

        expect(result.length).toBe(nonZeroInputCount);
      }),
      { numRuns: 100 },
    );
  });
});
