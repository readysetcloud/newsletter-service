/**
 * Pricing utility functions for the Sponsorship Pricing Calculator UI.
 */

/**
 * Converts a UTC ISO 8601 timestamp string to a formatted local timezone string.
 *
 * @param utcIsoString - A valid UTC ISO 8601 timestamp (e.g., "2025-01-15T15:00:00Z")
 * @returns A formatted string in the user's local timezone (e.g., "Jan 15, 2025, 10:00 AM")
 */
export function formatUtcToLocal(utcIsoString: string): string {
  const date = new Date(utcIsoString);
  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
