import * as fc from 'fast-check';
import { normalizeUrl } from '../utils/url-normalizer.mjs';

/**
 * Feature: auto-interest-segmentation
 * Property 2: URL normalization is idempotent and strips tracking parameters
 *
 * **Validates: Requirements 2.7, 3.1**
 *
 * For any valid URL, normalizing it must: lowercase the hostname, remove known
 * tracking query parameters (utm_*, fbclid, gclid, etc.), and remove trailing
 * slashes from the path. Normalizing an already-normalized URL must produce the
 * same result (idempotence: normalize(normalize(url)) === normalize(url)).
 */

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'dclid', 'twclkd',
  'mc_cid', 'mc_eid', 'ref', '_hsenc', '_hsmi'
];

const NON_TRACKING_PARAMS = ['page', 'id', 'q', 'sort', 'filter', 'lang', 'v', 'tab'];

/**
 * Arbitrary: generates a valid URL with optional tracking params,
 * mixed-case domains, and trailing slashes.
 */
const arbUrl = fc.record({
  protocol: fc.constantFrom('https', 'http'),
  subdomain: fc.constantFrom('', 'www.', 'blog.', 'docs.'),
  domain: fc.string({ minLength: 3, maxLength: 10, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')) }),
  tld: fc.constantFrom('.com', '.org', '.io', '.dev', '.net'),
  mixCase: fc.boolean(),
  path: fc.array(
    fc.string({ minLength: 1, maxLength: 12, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')) }),
    { minLength: 0, maxLength: 3 }
  ),
  trailingSlash: fc.boolean(),
  trackingParams: fc.subarray(TRACKING_PARAMS, { minLength: 0, maxLength: 5 }),
  nonTrackingParams: fc.subarray(NON_TRACKING_PARAMS, { minLength: 0, maxLength: 3 }),
}).map(({ protocol, subdomain, domain, tld, mixCase, path, trailingSlash, trackingParams, nonTrackingParams }) => {
  let host = `${subdomain}${domain}${tld}`;
  if (mixCase) {
    host = host.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c).join('');
  }
  const pathStr = path.length > 0 ? '/' + path.join('/') : '';
  const slash = trailingSlash && pathStr.length > 0 ? '/' : '';

  const params = new URLSearchParams();
  for (const tp of trackingParams) {
    params.set(tp, 'test_value');
  }
  for (const np of nonTrackingParams) {
    params.set(np, 'some_value');
  }
  const qs = params.toString() ? '?' + params.toString() : '';

  return `${protocol}://${host}${pathStr}${slash}${qs}`;
});

describe('Property 2: URL normalization is idempotent and strips tracking parameters', () => {
  /**
   * **Validates: Requirements 2.7, 3.1**
   */
  test('normalizeUrl is idempotent: normalizeUrl(normalizeUrl(url)) === normalizeUrl(url)', () => {
    fc.assert(
      fc.property(arbUrl, (url) => {
        const once = normalizeUrl(url);
        // normalizeUrl may return null for unparseable URLs; skip those
        if (once === null) return;
        const twice = normalizeUrl(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 100 }
    );
  });

  test('tracking parameters are removed from normalized URLs', () => {
    fc.assert(
      fc.property(arbUrl, (url) => {
        const normalized = normalizeUrl(url);
        if (normalized === null) return;

        const parsedUrl = new URL(normalized);
        for (const tp of TRACKING_PARAMS) {
          expect(parsedUrl.searchParams.has(tp)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('hostname is lowercased after normalization', () => {
    fc.assert(
      fc.property(arbUrl, (url) => {
        const normalized = normalizeUrl(url);
        if (normalized === null) return;

        const parsedUrl = new URL(normalized);
        expect(parsedUrl.hostname).toBe(parsedUrl.hostname.toLowerCase());
      }),
      { numRuns: 100 }
    );
  });

  test('no trailing slash on path (except root path)', () => {
    fc.assert(
      fc.property(arbUrl, (url) => {
        const normalized = normalizeUrl(url);
        if (normalized === null) return;

        const parsedUrl = new URL(normalized);
        if (parsedUrl.pathname !== '/') {
          expect(parsedUrl.pathname.endsWith('/')).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('non-tracking query parameters are preserved', () => {
    fc.assert(
      fc.property(arbUrl, (url) => {
        const normalized = normalizeUrl(url);
        if (normalized === null) return;

        const originalUrl = new URL(url);
        const normalizedUrl = new URL(normalized);

        for (const np of NON_TRACKING_PARAMS) {
          if (originalUrl.searchParams.has(np)) {
            expect(normalizedUrl.searchParams.get(np)).toBe(originalUrl.searchParams.get(np));
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
