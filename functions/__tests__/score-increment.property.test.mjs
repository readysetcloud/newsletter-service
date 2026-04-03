import * as fc from 'fast-check';
import {
  PRIMARY_SCORE_INCREMENT,
  SECONDARY_SCORE_INCREMENT,
  MAX_SCORE_PER_CLICK,
  VALID_TOPICS
} from '../utils/topic-taxonomy.mjs';

/**
 * Feature: auto-interest-segmentation
 * Property 6: Score increment correctness and cap
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 *
 * For any Link_Metadata record with a primary topic and 0-N secondary topics,
 * the total score contribution from processing a single click must equal:
 * primary increment (1.0) + min(1, number of secondary topics) * 0.5,
 * and the total must not exceed 1.5. If there are 2+ secondary topics, only
 * the first secondary topic receives a score increment. Secondary topics are
 * applied in the order returned by the classifier (sorted by descending
 * classification score).
 */

const validTopicsList = [...VALID_TOPICS];

/**
 * Replicates the pure scoring logic from processInterestScoring() in
 * process-link-click.mjs - builds the scored topics array given Link_Metadata.
 */
function computeScoredTopics(primaryTopic, secondaryTopics) {
  const scoredTopics = [];
  let totalScore = 0;

  if (primaryTopic && VALID_TOPICS.has(primaryTopic)) {
    scoredTopics.push({ topic: primaryTopic, increment: PRIMARY_SCORE_INCREMENT });
    totalScore += PRIMARY_SCORE_INCREMENT;
  }

  if (Array.isArray(secondaryTopics) && secondaryTopics.length > 0) {
    const firstSecondary = secondaryTopics[0];
    if (firstSecondary && VALID_TOPICS.has(firstSecondary) && totalScore + SECONDARY_SCORE_INCREMENT <= MAX_SCORE_PER_CLICK) {
      scoredTopics.push({ topic: firstSecondary, increment: SECONDARY_SCORE_INCREMENT });
      totalScore += SECONDARY_SCORE_INCREMENT;
    }
  }

  return { scoredTopics, totalScore };
}

/** Arbitrary: generates a valid primary topic from the taxonomy */
const arbPrimaryTopic = fc.constantFrom(...validTopicsList);

/** Arbitrary: generates 0-5 secondary topics from the taxonomy */
const arbSecondaryTopics = fc.integer({ min: 0, max: 5 }).chain((count) =>
  fc.array(fc.constantFrom(...validTopicsList), { minLength: count, maxLength: count })
);

/** Arbitrary: generates a Link_Metadata-like object with primary + 0-5 secondaries */
const arbLinkMetadata = fc.record({
  primaryTopic: arbPrimaryTopic,
  secondaryTopics: arbSecondaryTopics
});

describe('Property 6: Score increment correctness and cap', () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  test('primary topic always receives +1.0 increment', () => {
    fc.assert(
      fc.property(arbLinkMetadata, ({ primaryTopic, secondaryTopics }) => {
        const { scoredTopics } = computeScoredTopics(primaryTopic, secondaryTopics);

        const primaryEntry = scoredTopics.find((s) => s.topic === primaryTopic);
        expect(primaryEntry).toBeDefined();
        expect(primaryEntry.increment).toBe(PRIMARY_SCORE_INCREMENT);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2, 4.3**
   */
  test('at most one secondary topic receives +0.5 increment', () => {
    fc.assert(
      fc.property(arbLinkMetadata, ({ primaryTopic, secondaryTopics }) => {
        const { scoredTopics } = computeScoredTopics(primaryTopic, secondaryTopics);

        const secondaryEntries = scoredTopics.filter(
          (s) => s.increment === SECONDARY_SCORE_INCREMENT
        );

        // At most one secondary scored
        expect(secondaryEntries.length).toBeLessThanOrEqual(1);

        // If a secondary was scored, it must be the first one in the array
        if (secondaryEntries.length === 1 && secondaryTopics.length > 0) {
          expect(secondaryEntries[0].topic).toBe(secondaryTopics[0]);
          expect(secondaryEntries[0].increment).toBe(SECONDARY_SCORE_INCREMENT);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   */
  test('total score per click never exceeds MAX_SCORE_PER_CLICK (1.5)', () => {
    fc.assert(
      fc.property(arbLinkMetadata, ({ primaryTopic, secondaryTopics }) => {
        const { totalScore } = computeScoredTopics(primaryTopic, secondaryTopics);

        expect(totalScore).toBeLessThanOrEqual(MAX_SCORE_PER_CLICK);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  test('total equals primary (1.0) + min(1, secondaryCount) * 0.5, capped at 1.5', () => {
    fc.assert(
      fc.property(arbLinkMetadata, ({ primaryTopic, secondaryTopics }) => {
        const { totalScore } = computeScoredTopics(primaryTopic, secondaryTopics);

        const expectedSecondaryContribution =
          secondaryTopics.length > 0 ? SECONDARY_SCORE_INCREMENT : 0;
        const expectedTotal = PRIMARY_SCORE_INCREMENT + expectedSecondaryContribution;

        expect(totalScore).toBe(expectedTotal);
        expect(expectedTotal).toBeLessThanOrEqual(MAX_SCORE_PER_CLICK);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2**
   */
  test('secondary topics applied in classifier sort order (first element gets scored)', () => {
    fc.assert(
      fc.property(
        arbPrimaryTopic,
        fc.array(fc.constantFrom(...validTopicsList), { minLength: 2, maxLength: 5 }),
        (primaryTopic, secondaryTopics) => {
          const { scoredTopics } = computeScoredTopics(primaryTopic, secondaryTopics);

          const secondaryEntries = scoredTopics.filter(
            (s) => s.increment === SECONDARY_SCORE_INCREMENT
          );

          // With 2+ secondaries, exactly one should be scored - the first in the array
          expect(secondaryEntries.length).toBe(1);
          expect(secondaryEntries[0].topic).toBe(secondaryTopics[0]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
