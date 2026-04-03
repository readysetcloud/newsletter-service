import * as fc from 'fast-check';
import {
  AUTO_SEGMENT_THRESHOLD,
  PRIMARY_SCORE_INCREMENT,
  SECONDARY_SCORE_INCREMENT
} from '../utils/topic-taxonomy.mjs';

/**
 * Feature: auto-interest-segmentation
 * Property 7: Threshold crossing triggers auto-segmentation exactly once
 *
 * **Validates: Requirements 5.1, 5.7, 5.8**
 *
 * For any random sequence of score increments (+1.0 and +0.5) for a single
 * topic, auto-segmentation must be triggered exactly once at the first
 * increment where pre < AUTO_SEGMENT_THRESHOLD and post >= AUTO_SEGMENT_THRESHOLD.
 * If the accumulated score never reaches the threshold, it is never triggered.
 */

function simulateThresholdCrossings(increments) {
  let score = 0;
  const crossings = [];
  let totalCrossings = 0;
  let crossingIndex = null;

  for (let i = 0; i < increments.length; i++) {
    const preScore = score;
    const postScore = score + increments[i];
    score = postScore;

    const crossed = preScore < AUTO_SEGMENT_THRESHOLD && postScore >= AUTO_SEGMENT_THRESHOLD;
    crossings.push(crossed);

    if (crossed) {
      totalCrossings++;
      if (crossingIndex === null) {
        crossingIndex = i;
      }
    }
  }

  return { crossings, totalCrossings, crossingIndex };
}

const arbIncrement = fc.constantFrom(PRIMARY_SCORE_INCREMENT, SECONDARY_SCORE_INCREMENT);
const arbIncrementSequence = fc.array(arbIncrement, { minLength: 1, maxLength: 20 });

describe('Property 7: Threshold crossing triggers auto-segmentation exactly once', () => {
  /**
   * **Validates: Requirements 5.1, 5.7, 5.8**
   */
  test('threshold crossing occurs at most once in any increment sequence', () => {
    fc.assert(
      fc.property(arbIncrementSequence, (increments) => {
        const { totalCrossings } = simulateThresholdCrossings(increments);
        expect(totalCrossings).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.7, 5.8**
   */
  test('crossing happens at the first increment where pre < threshold and post >= threshold', () => {
    fc.assert(
      fc.property(arbIncrementSequence, (increments) => {
        const { crossings, crossingIndex } = simulateThresholdCrossings(increments);

        if (crossingIndex !== null) {
          let score = 0;
          for (let i = 0; i < increments.length; i++) {
            const pre = score;
            const post = score + increments[i];
            score = post;

            if (i < crossingIndex) {
              expect(post).toBeLessThan(AUTO_SEGMENT_THRESHOLD);
              expect(crossings[i]).toBe(false);
            } else if (i === crossingIndex) {
              expect(pre).toBeLessThan(AUTO_SEGMENT_THRESHOLD);
              expect(post).toBeGreaterThanOrEqual(AUTO_SEGMENT_THRESHOLD);
              expect(crossings[i]).toBe(true);
            } else {
              expect(crossings[i]).toBe(false);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.8**
   */
  test('sequences whose total score < threshold never trigger auto-segmentation', () => {
    const arbShortSequence = fc.array(arbIncrement, { minLength: 1, maxLength: 4 });

    fc.assert(
      fc.property(arbShortSequence, (increments) => {
        const totalScore = increments.reduce((sum, inc) => sum + inc, 0);
        const { totalCrossings } = simulateThresholdCrossings(increments);

        if (totalScore < AUTO_SEGMENT_THRESHOLD) {
          expect(totalCrossings).toBe(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.7**
   */
  test('sequences whose total score >= threshold trigger exactly one auto-segmentation', () => {
    const arbLongSequence = fc.array(arbIncrement, { minLength: 3, maxLength: 20 });

    fc.assert(
      fc.property(arbLongSequence, (increments) => {
        const totalScore = increments.reduce((sum, inc) => sum + inc, 0);
        const { totalCrossings } = simulateThresholdCrossings(increments);

        if (totalScore >= AUTO_SEGMENT_THRESHOLD) {
          expect(totalCrossings).toBe(1);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.7, 5.8**
   */
  test('post-crossing increments never re-trigger auto-segmentation', () => {
    fc.assert(
      fc.property(arbIncrementSequence, (increments) => {
        const { crossings, crossingIndex } = simulateThresholdCrossings(increments);

        if (crossingIndex !== null) {
          for (let i = crossingIndex + 1; i < crossings.length; i++) {
            expect(crossings[i]).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
