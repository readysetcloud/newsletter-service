/**
 * Small formatters for the notification panel.
 *
 * Separate from the component so they can be tested and imported without
 * dragging a component in, and so the component file exports a component and
 * nothing else (which is what keeps fast refresh working).
 */

/**
 * "4m", "3h", "2d" — short enough to sit at the end of a row without wrapping.
 *
 * Anything older than a week becomes a date, because "63d" is not something
 * anyone reads as a time. A timestamp in the future reads as "just now" rather
 * than as a negative age: clock skew should not produce nonsense.
 */
export const shortAgo = (iso: string, now: number = Date.now()): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const seconds = Math.max(0, Math.round((now - then) / 1000));

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;

  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * The badge's text.
 *
 * The API counts unread over recent notifications rather than all history and
 * says when it stopped; this says so too, rather than showing a capped figure
 * as though it were exact.
 */
export const badgeLabel = (count: number, capped: boolean): string =>
  capped ? `${count}+` : String(count);
