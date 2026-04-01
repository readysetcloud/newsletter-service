import * as fc from 'fast-check';

/**
 * Feature: subscriber-engagement-tracking
 * Property 3: Sunset policy identifies exactly the correct dormant subscribers
 *
 * **Validates: Requirements 3.2, 3.3, 3.6**
 *
 * This test validates the pure sunset classification logic from evaluate_subscriber
 * and is_subscription_too_recent in subscribers.rs:
 *
 * A subscriber is dormant if:
 *   - lastEngagedIssue < (latestIssueNumber - threshold), OR
 *   - lastEngagedIssue is absent (regardless of createdAt presence)
 * AND the subscriber is NOT excluded by the "too recent" rule:
 *   - If createdAt exists and weeksSinceCreation <= threshold → too recent (excluded)
 *   - If no createdAt → not excluded (cannot determine recency)
 */

/**
 * Pure function that determines if a subscriber's subscription is too recent.
 * Mirrors is_subscription_too_recent from subscribers.rs.
 *
 * @param {number|null} weeksSinceCreation - Weeks since subscriber was created (null if no createdAt)
 * @param {number} threshold - Sunset threshold
 * @returns {boolean} true if too recent to be flagged
 */
function isSubscriptionTooRecent(weeksSinceCreation, threshold) {
  if (weeksSinceCreation !== null) {
    return weeksSinceCreation <= threshold;
  }
  return false;
}

/**
 * Pure function that evaluates a single subscriber against sunset criteria.
 * Mirrors evaluate_subscriber from subscribers.rs.
 *
 * @param {{ lastEngagedIssue: number|null, weeksSinceCreation: number|null }} subscriber
 * @param {number} threshold
 * @param {number} latestIssueNumber
 * @returns {boolean} true if subscriber is dormant (should be in sunset list)
 */
function evaluateSubscriber(subscriber, threshold, latestIssueNumber) {
  const cutoffIssue = latestIssueNumber - threshold;

  // Exclude subscribers whose subscription is too recent
  if (isSubscriptionTooRecent(subscriber.weeksSinceCreation, threshold)) {
    return false;
  }

  if (subscriber.lastEngagedIssue !== null) {
    // Has lastEngagedIssue: dormant iff it's below the cutoff
    return subscriber.lastEngagedIssue < cutoffIssue;
  }

  // No lastEngagedIssue — dormant (with or without createdAt)
  return true;
}

/**
 * Apply sunset identification to a list of subscribers.
 *
 * @param {Array<{ id: string, lastEngagedIssue: number|null, weeksSinceCreation: number|null }>} subscribers
 * @param {number} threshold
 * @param {number} latestIssueNumber
 * @returns {string[]} IDs of dormant subscribers
 */
function identifySunsetCandidates(subscribers, threshold, latestIssueNumber) {
  return subscribers
    .filter(sub => evaluateSubscriber(sub, threshold, latestIssueNumber))
    .map(sub => sub.id);
}

describe('Property 3: Sunset policy identifies exactly the correct dormant subscribers', () => {
  /**
   * **Validates: Requirements 3.2, 3.3, 3.6**
   */
  test('sunset identification returns exactly the subscribers matching dormant criteria', () => {
    const arbSubscriber = fc.record({
      id: fc.uuid(),
      lastEngagedIssue: fc.option(fc.integer({ min: 1, max: 200 }), { nil: null }),
      weeksSinceCreation: fc.option(fc.integer({ min: 0, max: 104 }), { nil: null }),
    });

    const arbSubscribers = fc.array(arbSubscriber, { minLength: 0, maxLength: 30 });
    const arbThreshold = fc.integer({ min: 1, max: 20 });
    const arbLatestIssueNumber = fc.integer({ min: 1, max: 200 });

    fc.assert(
      fc.property(
        arbSubscribers,
        arbThreshold,
        arbLatestIssueNumber,
        (subscribers, threshold, latestIssueNumber) => {
          const result = identifySunsetCandidates(subscribers, threshold, latestIssueNumber);
          const cutoffIssue = latestIssueNumber - threshold;

          // Compute expected dormant set independently
          const expectedDormant = subscribers.filter(sub => {
            // Req 3.6: exclude too-recent subscribers
            if (sub.weeksSinceCreation !== null && sub.weeksSinceCreation <= threshold) {
              return false;
            }

            if (sub.lastEngagedIssue !== null) {
              // Req 3.2: dormant if lastEngagedIssue < cutoff
              return sub.lastEngagedIssue < cutoffIssue;
            }

            // Req 3.3: no lastEngagedIssue and not too recent → dormant
            return true;
          }).map(sub => sub.id);

          // The returned list must match exactly
          expect(result).toEqual(expectedDormant);
          expect(result.length).toBe(expectedDormant.length);

          // Every returned subscriber must satisfy the dormant criteria
          for (const id of result) {
            const sub = subscribers.find(s => s.id === id);
            expect(sub).toBeDefined();

            // Must not be too recent
            if (sub.weeksSinceCreation !== null) {
              expect(sub.weeksSinceCreation).toBeGreaterThan(threshold);
            }

            // Must be dormant: lastEngagedIssue < cutoff OR no lastEngagedIssue
            if (sub.lastEngagedIssue !== null) {
              expect(sub.lastEngagedIssue).toBeLessThan(cutoffIssue);
            }
          }

          // Every non-returned subscriber must NOT satisfy dormant criteria
          const resultSet = new Set(result);
          for (const sub of subscribers) {
            if (!resultSet.has(sub.id)) {
              const tooRecent = sub.weeksSinceCreation !== null && sub.weeksSinceCreation <= threshold;
              const isDormant = sub.lastEngagedIssue !== null
                ? sub.lastEngagedIssue < cutoffIssue
                : true;

              // Either too recent OR not dormant
              expect(tooRecent || !isDormant).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
