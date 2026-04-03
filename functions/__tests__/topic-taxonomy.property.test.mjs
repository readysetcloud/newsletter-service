import * as fc from 'fast-check';
import { TOPICS, VALID_TOPICS } from '../utils/topic-taxonomy.mjs';

/**
 * Feature: auto-interest-segmentation
 * Property 1: Topic taxonomy entries have valid structure
 *
 * **Validates: Requirements 1.4, 1.5**
 *
 * For any topic in the Platform_Topic_Taxonomy, the topic must have a
 * machine-readable label (lowercase, containing only [a-z-] characters)
 * and a non-empty human-readable display name. The taxonomy must contain
 * between 8 and 15 topics.
 */

const LABEL_PATTERN = /^[a-z][a-z-]*$/;

describe('Property 1: Topic taxonomy entries have valid structure', () => {
  /**
   * **Validates: Requirements 1.4, 1.5**
   */
  test('taxonomy contains between 8 and 15 topics', () => {
    const topicCount = Object.keys(TOPICS).length;
    expect(topicCount).toBeGreaterThanOrEqual(8);
    expect(topicCount).toBeLessThanOrEqual(15);
  });

  test('every topic label matches /^[a-z][a-z-]*$/ and display name is non-empty', () => {
    const topicKeys = Object.keys(TOPICS);
    const arbitraryTopicKey = fc.constantFrom(...topicKeys);

    fc.assert(
      fc.property(arbitraryTopicKey, (key) => {
        const topic = TOPICS[key];

        // Label must match the lowercase-hyphen pattern
        expect(topic.label).toMatch(LABEL_PATTERN);

        // Object key must equal the label
        expect(key).toBe(topic.label);

        // Display name must be a non-empty string
        expect(typeof topic.display).toBe('string');
        expect(topic.display.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  test('VALID_TOPICS set is consistent with TOPICS object keys', () => {
    const topicKeys = Object.keys(TOPICS);
    const arbitraryTopicKey = fc.constantFrom(...topicKeys);

    fc.assert(
      fc.property(arbitraryTopicKey, (key) => {
        expect(VALID_TOPICS.has(key)).toBe(true);
      }),
      { numRuns: 100 }
    );

    // Also verify sizes match (no extra entries in VALID_TOPICS)
    expect(VALID_TOPICS.size).toBe(topicKeys.length);
  });
});
