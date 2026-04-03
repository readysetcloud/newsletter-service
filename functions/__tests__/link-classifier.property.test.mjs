import * as fc from 'fast-check';
import { classifyLink } from '../utils/link-classifier.mjs';
import { VALID_TOPICS } from '../utils/topic-taxonomy.mjs';

/**
 * Feature: auto-interest-segmentation
 * Property 3: Classifier output validity
 *
 * **Validates: Requirements 2.3, 2.4, 2.5, 2.6**
 *
 * For any URL and anchor text input, the classifier output must satisfy:
 * confidence is in the range [0.0, 1.0], secondary topics contains at most 2
 * entries, all topic labels are members of the Platform_Topic_Taxonomy, and if
 * no topic was matched then primaryTopic is null, secondaryTopics is empty, and
 * confidence is 0.0.
 */

/**
 * Arbitrary: generates a random URL string.
 */
const arbUrl = fc.record({
  protocol: fc.constantFrom('https', 'http'),
  subdomain: fc.constantFrom('', 'www.', 'blog.', 'docs.', 'api.'),
  domain: fc.string({
    minLength: 3,
    maxLength: 12,
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
  }),
  tld: fc.constantFrom('.com', '.org', '.io', '.dev', '.net', '.co'),
  path: fc.array(
    fc.string({
      minLength: 1,
      maxLength: 10,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    }),
    { minLength: 0, maxLength: 4 }
  ),
}).map(({ protocol, subdomain, domain, tld, path }) => {
  const pathStr = path.length > 0 ? '/' + path.join('/') : '';
  return `${protocol}://${subdomain}${domain}${tld}${pathStr}`;
});

/**
 * Arbitrary: generates random anchor text (mix of random words and
 * occasionally topic-related keywords to exercise both matched and
 * unmatched paths).
 */
const arbAnchorText = fc.oneof(
  fc.string({ minLength: 0, maxLength: 80 }),
  fc.array(
    fc.constantFrom(
      'click here', 'read more', 'learn about', 'serverless', 'ai',
      'machine learning', 'react', 'database', 'security', 'devops',
      'cloud', 'testing', 'career', 'observability', 'api', 'random',
      'newsletter', 'subscribe', 'hello world', ''
    ),
    { minLength: 0, maxLength: 5 }
  ).map(words => words.join(' '))
);

describe('Property 3: Classifier output validity', () => {
  /**
   * **Validates: Requirements 2.3, 2.4, 2.5, 2.6**
   */
  test('confidence is in [0, 1] for any input', () => {
    fc.assert(
      fc.property(arbUrl, arbAnchorText, (url, anchorText) => {
        const result = classifyLink(url, anchorText);
        expect(result.confidence).toBeGreaterThanOrEqual(0.0);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 100 }
    );
  });

  test('secondaryTopics contains at most 2 entries', () => {
    fc.assert(
      fc.property(arbUrl, arbAnchorText, (url, anchorText) => {
        const result = classifyLink(url, anchorText);
        expect(result.secondaryTopics.length).toBeLessThanOrEqual(2);
      }),
      { numRuns: 100 }
    );
  });

  test('all topic labels are members of VALID_TOPICS', () => {
    fc.assert(
      fc.property(arbUrl, arbAnchorText, (url, anchorText) => {
        const result = classifyLink(url, anchorText);
        if (result.primaryTopic !== null) {
          expect(VALID_TOPICS.has(result.primaryTopic)).toBe(true);
        }
        for (const topic of result.secondaryTopics) {
          expect(VALID_TOPICS.has(topic)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('if confidence < 0.5 then primaryTopic is null and secondaryTopics is empty', () => {
    fc.assert(
      fc.property(arbUrl, arbAnchorText, (url, anchorText) => {
        const result = classifyLink(url, anchorText);
        if (result.confidence < 0.5) {
          expect(result.primaryTopic).toBeNull();
          expect(result.secondaryTopics).toEqual([]);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('classifiedBy is always "heuristic"', () => {
    fc.assert(
      fc.property(arbUrl, arbAnchorText, (url, anchorText) => {
        const result = classifyLink(url, anchorText);
        expect(result.classifiedBy).toBe('heuristic');
      }),
      { numRuns: 100 }
    );
  });
});
