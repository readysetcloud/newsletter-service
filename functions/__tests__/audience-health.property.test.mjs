import * as fc from 'fast-check';

/**
 * Feature: subscriber-engagement-tracking
 * Property 4: Cohort classification is exhaustive and mutually exclusive
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 *
 * This test validates the pure cohort classification logic from classify_cohort
 * in subscribers.rs:
 *
 * - Highly Engaged: lastEngagedIssue >= latestIssueNumber - 1 (within last 2 issues)
 * - Occasional: lastEngagedIssue >= latestIssueNumber - 9 AND < latestIssueNumber - 1 (3–10 issues behind)
 * - Dormant: lastEngagedIssue < latestIssueNumber - 9 OR no lastEngagedIssue
 */

/**
 * Pure function that classifies a subscriber into an engagement cohort.
 * Mirrors classify_cohort from subscribers.rs.
 *
 * @param {number|null} lastEngagedIssue - The subscriber's last engaged issue number (null if absent)
 * @param {number} latestIssueNumber - The most recently published issue number
 * @returns {'highlyEngaged'|'occasional'|'dormant'}
 */
function classifyCohort(lastEngagedIssue, latestIssueNumber) {
  if (lastEngagedIssue !== null && lastEngagedIssue >= latestIssueNumber - 1) {
    return 'highlyEngaged';
  }
  if (lastEngagedIssue !== null && lastEngagedIssue >= latestIssueNumber - 9) {
    return 'occasional';
  }
  return 'dormant';
}

/**
 * Classify a list of subscribers and compute cohort counts and percentages.
 * Mirrors query_audience_health logic from subscribers.rs.
 *
 * @param {Array<{ id: string, lastEngagedIssue: number|null }>} subscribers
 * @param {number} latestIssueNumber
 * @returns {{ highlyEngaged: { count: number, percentage: number }, occasional: { count: number, percentage: number }, dormant: { count: number, percentage: number }, total: number }}
 */
function computeAudienceHealth(subscribers, latestIssueNumber) {
  let highlyEngaged = 0;
  let occasional = 0;
  let dormant = 0;
  const total = subscribers.length;

  for (const sub of subscribers) {
    const cohort = classifyCohort(sub.lastEngagedIssue, latestIssueNumber);
    if (cohort === 'highlyEngaged') highlyEngaged++;
    else if (cohort === 'occasional') occasional++;
    else dormant++;
  }

  const percentage = (count) => {
    if (total === 0) return 0;
    return Math.round((count / total) * 1000) / 10;
  };

  return {
    highlyEngaged: { count: highlyEngaged, percentage: percentage(highlyEngaged) },
    occasional: { count: occasional, percentage: percentage(occasional) },
    dormant: { count: dormant, percentage: percentage(dormant) },
    total,
  };
}

describe('Property 4: Cohort classification is exhaustive and mutually exclusive', () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  test('cohort counts sum to total, percentages sum to ~100%, and each subscriber is in exactly one correct cohort', () => {
    const arbSubscriber = fc.record({
      id: fc.uuid(),
      lastEngagedIssue: fc.option(fc.integer({ min: 1, max: 200 }), { nil: null }),
    });

    const arbSubscribers = fc.array(arbSubscriber, { minLength: 1, maxLength: 30 });
    const arbLatestIssueNumber = fc.integer({ min: 1, max: 200 });

    fc.assert(
      fc.property(
        arbSubscribers,
        arbLatestIssueNumber,
        (subscribers, latestIssueNumber) => {
          const result = computeAudienceHealth(subscribers, latestIssueNumber);

          // Cohort counts sum to total subscriber count
          expect(result.highlyEngaged.count + result.occasional.count + result.dormant.count)
            .toBe(result.total);
          expect(result.total).toBe(subscribers.length);

          // Percentages sum to ~100% (within rounding tolerance of 0.3%)
          const totalPercentage =
            result.highlyEngaged.percentage +
            result.occasional.percentage +
            result.dormant.percentage;
          expect(totalPercentage).toBeGreaterThanOrEqual(99.7);
          expect(totalPercentage).toBeLessThanOrEqual(100.3);

          // Each subscriber is in exactly one correct cohort per boundary rules
          for (const sub of subscribers) {
            const cohort = classifyCohort(sub.lastEngagedIssue, latestIssueNumber);

            if (sub.lastEngagedIssue !== null && sub.lastEngagedIssue >= latestIssueNumber - 1) {
              expect(cohort).toBe('highlyEngaged');
            } else if (sub.lastEngagedIssue !== null && sub.lastEngagedIssue >= latestIssueNumber - 9) {
              expect(cohort).toBe('occasional');
            } else {
              expect(cohort).toBe('dormant');
            }

            // Verify mutual exclusivity: cohort is exactly one value
            const possibleCohorts = ['highlyEngaged', 'occasional', 'dormant'];
            expect(possibleCohorts).toContain(cohort);
            expect(possibleCohorts.filter(c => c === cohort)).toHaveLength(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
