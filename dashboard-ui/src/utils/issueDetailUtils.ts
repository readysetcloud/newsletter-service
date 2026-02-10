/**
 * Utility functions for the Issue Detail Page redesign
 */

import type { IssueMetrics } from '../types/issues';

/**
 * Comparison result for metrics
 */
export interface ComparisonResult {
  difference: number; // Percentage difference
  direction: 'up' | 'down' | 'neutral';
  isPositive: boolean; // Whether the change is good or bad
}

/**
 * Calculate comparison between current and comparison metric
 * @param current - Current metric value
 * @param comparison - Comparison metric value
 * @param metricType - Type of metric (determines if up is positive)
 * @returns Comparison result with difference, direction, and positivity
 */
export function calculateComparison(
  current: number,
  comparison: number,
  metricType: 'positive' | 'negative' = 'positive'
): ComparisonResult {
  if (comparison === 0) {
    return {
      difference: 0,
      direction: 'neutral',
      isPositive: true,
    };
  }

  const difference = ((current - comparison) / comparison) * 100;
  const direction = difference > 0.1 ? 'up' : difference < -0.1 ? 'down' : 'neutral';

  // For positive metrics (open rate, click rate), up is good
  // For negative metrics (bounce rate, complaint rate), down is good
  const isPositive =
    metricType === 'positive'
      ? direction === 'up' || direction === 'neutral'
      : direction === 'down' || direction === 'neutral';

  return {
    difference,
    direction,
    isPositive,
  };
}

/**
 * Format a date string
 */
export function formatDate(dateString: string, includeTime: boolean = true): string {
  const date = new Date(dateString);

  if (includeTime) {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a percentage value
 * @param value - Numerator
 * @param total - Denominator
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number, total: number, decimals: number = 1): string {
  if (total === 0) return '0%';
  const percentage = (value / total) * 100;
  return `${percentage.toFixed(decimals)}%`;
}

/**
 * Format a number with locale-specific thousands separators
 * @param value - Number to format
 * @returns Formatted number string
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Format a percentage value directly (when already calculated)
 * @param percentage - Percentage value (0-100)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string
 */
export function formatPercentageValue(percentage: number, decimals: number = 1): string {
  return `${percentage.toFixed(decimals)}%`;
}

/**
 * Determine if a section should be visible based on data availability
 * @param sectionId - Section identifier
 * @param analytics - Analytics data
 * @param stats - Issue stats
 * @returns Whether the section should be shown
 */
export function shouldShowSection(
  sectionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analytics: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stats: any
): boolean {
  switch (sectionId) {
    case 'engagement':
      return !!(
        analytics?.links?.length > 0 ||
        analytics?.clickDecay?.length > 0 ||
        analytics?.openDecay?.length > 0 ||
        analytics?.trafficSource
      );

    case 'audience':
      return !!(
        analytics?.geoDistribution?.length > 0 ||
        analytics?.deviceBreakdown ||
        analytics?.timingMetrics
      );

    case 'deliverability':
      return !!(
        analytics?.bounceReasons ||
        analytics?.complaintDetails?.length > 0 ||
        analytics?.engagementType ||
        stats?.bounces > 0 ||
        stats?.complaints > 0
      );

    case 'geographic':
      return !!(analytics?.geoDistribution?.length > 0);

    case 'links':
      return !!(analytics?.links?.length > 0);

    case 'decay':
      return !!(
        analytics?.clickDecay?.length > 0 ||
        analytics?.openDecay?.length > 0
      );

    case 'timing':
      return !!(analytics?.timingMetrics);

    default:
      return true;
  }
}

/**
 * Get section visibility configuration
 * @param analytics - Analytics data
 * @param stats - Issue stats
 * @returns Map of section IDs to visibility
 */
export function getSectionVisibility(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analytics: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stats: any
): Record<string, boolean> {
  return {
    engagement: shouldShowSection('engagement', analytics, stats),
    audience: shouldShowSection('audience', analytics, stats),
    deliverability: shouldShowSection('deliverability', analytics, stats),
    geographic: shouldShowSection('geographic', analytics, stats),
    links: shouldShowSection('links', analytics, stats),
    decay: shouldShowSection('decay', analytics, stats),
    timing: shouldShowSection('timing', analytics, stats),
  };
}

/**
 * Calculate deliverability health status
 * @param bounceRate - Bounce rate percentage
 * @param complaintRate - Complaint rate percentage
 * @returns Health status
 */
export function calculateDeliverabilityHealth(
  bounceRate: number,
  complaintRate: number
): 'excellent' | 'good' | 'warning' | 'critical' {
  if (complaintRate > 0.1 || bounceRate > 10) return 'critical';
  if (complaintRate > 0.05 || bounceRate > 5) return 'warning';
  if (bounceRate < 2 && complaintRate < 0.01) return 'excellent';
  return 'good';
}

/**
 * Format time duration in a human-readable format
 * @param hours - Duration in hours
 * @returns Formatted duration string
 */
export function formatDuration(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  if (hours < 24) {
    const roundedHours = Math.round(hours * 10) / 10;
    return `${roundedHours} hour${roundedHours !== 1 ? 's' : ''}`;
  }

  const days = Math.round(hours / 24 * 10) / 10;
  return `${days} day${days !== 1 ? 's' : ''}`;
}

/**
 * Truncate a URL to a maximum length
 * @param url - URL to truncate
 * @param maxLength - Maximum length (default: 50)
 * @returns Truncated URL
 */
export function truncateUrl(url: string, maxLength: number = 50): string {
  if (url.length <= maxLength) return url;

  const ellipsis = '...';
  const charsToShow = maxLength - ellipsis.length;
  const frontChars = Math.ceil(charsToShow * 0.6);
  const backChars = Math.floor(charsToShow * 0.4);

  return url.substring(0, frontChars) + ellipsis + url.substring(url.length - backChars);
}

/**
 * Get comparison label text
 * @param comparisonType - Type of comparison
 * @returns Label text
 */
export function getComparisonLabel(
  comparisonType: 'average' | 'last' | 'best'
): string {
  switch (comparisonType) {
    case 'average':
      return 'vs. Average';
    case 'last':
      return 'vs. Last Issue';
    case 'best':
      return 'vs. Best Issue';
    default:
      return '';
  }
}

/**
 * Calculate overall performance score (0-100)
 * @param metrics - Issue metrics
 * @returns Performance score
 */
export function calculatePerformanceScore(metrics: IssueMetrics): number {
  // Weight: 40% open rate, 40% click rate, 10% low bounce, 10% low complaint
  const openScore = Math.min(metrics.openRate / 50 * 40, 40); // 50% open rate = max score
  const clickScore = Math.min(metrics.clickRate / 10 * 40, 40); // 10% click rate = max score
  const bounceScore = Math.max(10 - (metrics.bounceRate / 10 * 10), 0); // 0% bounce = max score
  const complaintScore = Math.max(10 - (((metrics.complaints / metrics.delivered) * 100) / 0.1 * 10), 0); // 0% complaint = max score

  return Math.round(openScore + clickScore + bounceScore + complaintScore);
}

/**
 * User preferences for issue detail page
 */
export interface UserPreferences {
  issueDetail: {
    expandedSections: string[];
    defaultComparison: 'average' | 'last' | 'best';
    showPercentages: boolean;
    chartStyle: 'line' | 'bar' | 'area';
  };
}

/**
 * Default user preferences
 */
export function getDefaultPreferences(): UserPreferences['issueDetail'] {
  return {
    expandedSections: [],
    defaultComparison: 'average',
    showPercentages: true,
    chartStyle: 'line',
  };
}

/**
 * LocalStorage key for user preferences
 */
const PREFERENCES_KEY = 'issue-detail-preferences';

/**
 * Save user preferences to localStorage
 * @param preferences - User preferences to save
 * @returns Whether save was successful
 */
export function savePreferences(preferences: UserPreferences['issueDetail']): boolean {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch (error) {
    console.warn('Failed to save user preferences:', error);
    // Handle quota exceeded or other localStorage errors
    if (error instanceof Error) {
      if (error.name === 'QuotaExceededError') {
        console.error('localStorage quota exceeded. Unable to save preferences.');
      } else if (error.name === 'SecurityError') {
        console.error('localStorage access denied. Unable to save preferences.');
      }
    }
    return false;
  }
}

/**
 * Load user preferences from localStorage
 * @returns User preferences or default preferences if loading fails
 */
export function loadPreferences(): UserPreferences['issueDetail'] {
  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    if (!stored) {
      return getDefaultPreferences();
    }

    const parsed = JSON.parse(stored);

    // Validate the loaded preferences structure
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray(parsed.expandedSections) &&
      ['average', 'last', 'best'].includes(parsed.defaultComparison) &&
      typeof parsed.showPercentages === 'boolean' &&
      ['line', 'bar', 'area'].includes(parsed.chartStyle)
    ) {
      return parsed;
    }

    // If validation fails, return defaults
    console.warn('Invalid preferences structure, using defaults');
    return getDefaultPreferences();
  } catch (error) {
    console.warn('Failed to load user preferences:', error);
    return getDefaultPreferences();
  }
}

/**
 * Clear user preferences from localStorage
 * @returns Whether clear was successful
 */
export function clearPreferences(): boolean {
  try {
    localStorage.removeItem(PREFERENCES_KEY);
    return true;
  } catch (error) {
    console.warn('Failed to clear user preferences:', error);
    return false;
  }
}

/**
 * Update a specific preference field
 * @param field - Field to update
 * @param value - New value
 * @returns Whether update was successful
 */
export function updatePreference<K extends keyof UserPreferences['issueDetail']>(
  field: K,
  value: UserPreferences['issueDetail'][K]
): boolean {
  try {
    const current = loadPreferences();
    current[field] = value;
    return savePreferences(current);
  } catch (error) {
    console.warn(`Failed to update preference ${field}:`, error);
    return false;
  }
}

/**
 * SessionStorage key for scroll position
 */
const SCROLL_POSITION_KEY = 'issue-detail-scroll-position';

/**
 * Save scroll position to sessionStorage
 * @param issueId - Issue ID to associate with scroll position
 * @param position - Scroll position in pixels
 * @returns Whether save was successful
 */
export function saveScrollPosition(issueId: string, position: number): boolean {
  try {
    const scrollData = {
      issueId,
      position,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(SCROLL_POSITION_KEY, JSON.stringify(scrollData));
    return true;
  } catch (error) {
    console.warn('Failed to save scroll position:', error);
    return false;
  }
}

/**
 * Load scroll position from sessionStorage
 * @param issueId - Issue ID to load scroll position for
 * @param maxAge - Maximum age of saved position in milliseconds (default: 5 minutes)
 * @returns Scroll position or null if not found or expired
 */
export function loadScrollPosition(issueId: string, maxAge: number = 5 * 60 * 1000): number | null {
  try {
    const stored = sessionStorage.getItem(SCROLL_POSITION_KEY);
    if (!stored) {
      return null;
    }

    const scrollData = JSON.parse(stored);

    // Validate structure
    if (
      typeof scrollData !== 'object' ||
      scrollData === null ||
      typeof scrollData.issueId !== 'string' ||
      typeof scrollData.position !== 'number' ||
      typeof scrollData.timestamp !== 'number'
    ) {
      console.warn('Invalid scroll position data structure');
      return null;
    }

    // Check if it's for the correct issue
    if (scrollData.issueId !== issueId) {
      return null;
    }

    // Check if it's not too old
    const age = Date.now() - scrollData.timestamp;
    if (age > maxAge) {
      // Clear expired data
      sessionStorage.removeItem(SCROLL_POSITION_KEY);
      return null;
    }

    return scrollData.position;
  } catch (error) {
    console.warn('Failed to load scroll position:', error);
    return null;
  }
}

/**
 * Clear scroll position from sessionStorage
 * @returns Whether clear was successful
 */
export function clearScrollPosition(): boolean {
  try {
    sessionStorage.removeItem(SCROLL_POSITION_KEY);
    return true;
  } catch (error) {
    console.warn('Failed to clear scroll position:', error);
    return false;
  }
}
