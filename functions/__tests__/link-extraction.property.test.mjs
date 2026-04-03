import * as fc from 'fast-check';
import { extractLinks } from '../update-link-tracking.mjs';

/**
 * Feature: auto-interest-segmentation
 * Property 4: Link extraction captures all hyperlinks from markdown content
 *
 * **Validates: Requirements 2.1**
 *
 * For any markdown string containing N hyperlinks (in [text](url) format,
 * excluding mailto: links), the link extraction function must return exactly
 * N link entries, each with the correct URL and anchor text.
 */

/**
 * Arbitrary: generates safe anchor text that won't break markdown link syntax.
 * Excludes characters: [ ] ( )
 */
const arbAnchorText = fc.string({
  minLength: 1,
  maxLength: 30,
  unit: fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.,!?:;\'\"&+=#@'.split('')
  ),
});

/**
 * Arbitrary: generates a safe URL that won't break markdown link syntax.
 * Excludes parentheses and brackets, and avoids mailto: prefix.
 */
const arbUrl = fc.record({
  domain: fc.string({
    minLength: 2,
    maxLength: 12,
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
  }),
  tld: fc.constantFrom('.com', '.org', '.io', '.dev', '.net'),
  path: fc.array(
    fc.string({
      minLength: 1,
      maxLength: 8,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    }),
    { minLength: 0, maxLength: 3 }
  ),
}).map(({ domain, tld, path }) => {
  const pathStr = path.length > 0 ? '/' + path.join('/') : '';
  return `https://${domain}${tld}${pathStr}`;
});

/**
 * Arbitrary: generates non-link filler text (no markdown link patterns).
 */
const arbFillerText = fc.string({
  minLength: 0,
  maxLength: 50,
  unit: fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?:;-_\n'.split('')
  ),
});

/**
 * Arbitrary: generates a markdown document with exactly N links
 * interspersed with non-link filler text.
 */
const arbMarkdownWithLinks = fc.array(
  fc.record({
    anchorText: arbAnchorText,
    url: arbUrl,
    filler: arbFillerText,
  }),
  { minLength: 0, maxLength: 15 }
).map((entries) => {
  let markdown = '';
  for (const { anchorText, url, filler } of entries) {
    markdown += filler + `[${anchorText}](${url})`;
  }
  // Add trailing filler
  markdown += ' some trailing text';
  return { markdown, expectedLinks: entries.map(e => ({ anchorText: e.anchorText, url: e.url })) };
});

describe('Property 4: Link extraction captures all hyperlinks from markdown content', () => {
  /**
   * **Validates: Requirements 2.1**
   */
  test('extracts exactly N links with correct URLs and anchor texts', () => {
    fc.assert(
      fc.property(arbMarkdownWithLinks, ({ markdown, expectedLinks }) => {
        const result = extractLinks(markdown);

        // Must return exactly N links
        expect(result.length).toBe(expectedLinks.length);

        // Each link must have the correct anchor text and URL
        for (let i = 0; i < expectedLinks.length; i++) {
          expect(result[i].anchorText).toBe(expectedLinks[i].anchorText);
          expect(result[i].url).toBe(expectedLinks[i].url);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('mailto: links are excluded from extraction', () => {
    fc.assert(
      fc.property(
        fc.array(arbAnchorText, { minLength: 1, maxLength: 5 }),
        fc.array(arbUrl, { minLength: 1, maxLength: 5 }),
        (anchors, urls) => {
          // Build markdown with a mix of regular and mailto links
          const regularCount = Math.min(anchors.length, urls.length);
          let markdown = '';
          const expectedLinks = [];

          for (let i = 0; i < regularCount; i++) {
            // Add a regular link
            markdown += `[${anchors[i]}](${urls[i]}) `;
            expectedLinks.push({ anchorText: anchors[i], url: urls[i] });

            // Add a mailto link (should be excluded)
            markdown += `[Email ${i}](mailto:test${i}@example.com) `;
          }

          const result = extractLinks(markdown);

          // mailto links should not be counted
          expect(result.length).toBe(expectedLinks.length);

          // All returned links should be non-mailto
          for (const link of result) {
            expect(link.url).not.toMatch(/^mailto:/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('returns empty array for content with no links', () => {
    fc.assert(
      fc.property(arbFillerText, (text) => {
        const result = extractLinks(text);
        expect(result).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});
