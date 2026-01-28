/**
 * Generates a URL-friendly slug from a title
 * Converts to lowercase, replaces spaces and special chars with hyphens
 */
export function generateSlug(title: string): string {
  if (!title) return '';

  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

/**
 * Validates if a slug is properly formatted
 */
export function isValidSlug(slug: string): boolean {
  if (!slug) return false;

  if (slug.length < 1 || slug.length > 100) return false;

  return SLUG_REGEX.test(slug);
}

/**
 * Regex pattern for valid slug format
 * Allows lowercase letters, numbers, and hyphens
 * Cannot start or end with hyphen
 */
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Formats a date string for consistent display
 */
export function formatDate(dateString: string): string {
  if (!dateString) return '';

  const date = new Date(dateString);

  if (isNaN(date.getTime())) return '';

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats a date string with time for detailed display
 */
export function formatDateTime(dateString: string): string {
  if (!dateString) return '';

  const date = new Date(dateString);

  if (isNaN(date.getTime())) return '';

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Formats a number as a percentage with specified decimal places
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  if (typeof value !== 'number' || isNaN(value)) return '0%';

  return `${value.toFixed(decimals)}%`;
}

/**
 * Formats a number with commas for thousands
 */
export function formatNumber(value: number): string {
  if (typeof value !== 'number' || isNaN(value)) return '0';

  return value.toLocaleString('en-US');
}

/**
 * Calculates percentage from two numbers
 */
export function calculatePercentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return (numerator / denominator) * 100;
}
