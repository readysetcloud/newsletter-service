/**
 * Engagement cohort classification shared across the Subscribers views.
 * Mirrors the audience-health thresholds used by the backend and the
 * subscriber list badges.
 */

export interface EngagementStatus {
  text: string;
  className: string;
}

export function getEngagementStatus(
  lastEngagedIssue: number | null,
  latestIssueNumber: number
): EngagementStatus {
  if (!latestIssueNumber || latestIssueNumber === 0) {
    return { text: 'Unknown', className: 'bg-muted text-muted-foreground' };
  }
  if (lastEngagedIssue === null) {
    return { text: 'Dormant', className: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400' };
  }
  if (lastEngagedIssue >= latestIssueNumber - 1) {
    return { text: 'Highly Engaged', className: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400' };
  }
  if (lastEngagedIssue >= latestIssueNumber - 9) {
    return { text: 'Occasional', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400' };
  }
  return { text: 'Dormant', className: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400' };
}
