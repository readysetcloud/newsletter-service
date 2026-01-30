/**
 * Device detection utility for analytics
 *
 * Uses simple user-agent string heuristics to categorize devices.
 * Targets ~85-90% accuracy for trend analysis (Phase 1 MVP).
 *
 * Known limitations:
 * - Mobile vs Tablet: Some devices report ambiguous user agents (e.g., iPad can appear as desktop Safari)
 * - Unknown devices: Bots, crawlers, and uncommon clients may not match patterns
 * - False positives: Desktop browsers in mobile mode may be misclassified
 *
 * Monitor "unknown" device percentage - if > 15%, investigate patterns.
 */

/**
 * Detect device type from user agent string
 *
 * @param {string} userAgent - User agent string from HTTP request
 * @returns {string} Device type: 'mobile', 'tablet', 'desktop', or 'unknown'
 */
export function detectDevice(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') {
    return 'unknown';
  }

  const ua = userAgent.toLowerCase();

  // Check for tablet first (more specific patterns)
  if (ua.includes('ipad') || ua.includes('tablet') || ua.includes('kindle')) {
    return 'tablet';
  }

  // Android tablets often include "android" but not "mobile"
  if (ua.includes('android') && !ua.includes('mobile')) {
    return 'tablet';
  }

  // Check for mobile devices
  if (
    ua.includes('mobile') ||
    ua.includes('iphone') ||
    ua.includes('ipod') ||
    ua.includes('android') ||
    ua.includes('blackberry') ||
    ua.includes('windows phone') ||
    ua.includes('webos')
  ) {
    return 'mobile';
  }

  // Check for desktop indicators
  if (
    ua.includes('windows') ||
    ua.includes('macintosh') ||
    ua.includes('linux') ||
    ua.includes('x11')
  ) {
    return 'desktop';
  }

  // Default to unknown for unrecognized patterns
  return 'unknown';
}
