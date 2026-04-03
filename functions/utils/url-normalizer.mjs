/**
 * URL normalization for consistent link hashing.
 * Used by both the content pipeline and click processor.
 */

/** Tracking params to strip */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'dclid', 'twclkd',
  'mc_cid', 'mc_eid', 'ref', '_hsenc', '_hsmi'
]);

/**
 * Normalizes a URL for consistent hashing:
 * - Lowercases the hostname
 * - Removes common tracking query parameters (utm_*, fbclid, gclid, etc.)
 * - Removes trailing slashes from the path
 * - Preserves non-tracking query parameters
 *
 * @param {string} rawUrl - The original URL
 * @returns {string|null} Normalized URL, or null if unparseable
 */
export function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    // Lowercase hostname (URL constructor already does this, but be explicit)
    url.hostname = url.hostname.toLowerCase();

    // Strip tracking query params
    const keysToDelete = [];
    for (const key of url.searchParams.keys()) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      url.searchParams.delete(key);
    }

    // Sort remaining params for consistent ordering
    url.searchParams.sort();

    // Remove trailing slashes from path
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';

    // Reconstruct: if no search params remain, omit the '?'
    return url.toString();
  } catch {
    return null;
  }
}
