import * as fc from 'fast-check';

/**
 * Feature: subscriber-engagement-tracking
 * Property 1: Engagement update preserves monotonic lastEngagedIssue and correct engagementCount
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 5.1, 5.2, 5.3
 *
 * This test simulates the DynamoDB conditional update logic:
 *   ConditionExpression: "attribute_not_exists(lastEngagedIssue) OR lastEngagedIssue < :issueNumber"
 *   UpdateExpression: "SET lastEngagedIssue = :issueNumber ADD engagementCount :one"
 *
 * If the condition passes: lastEngagedIssue is set to issueNumber, engagementCount increments by 1.
 * If the condition fails (ConditionalCheckFailedException): no change (same-issue dedup or out-of-order).
 */

/**
 * Pure function that simulates the DynamoDB conditional update logic
 * for subscriber engagement tracking.
 *
 * @param {number|undefined} previousLastEngagedIssue - Current lastEngagedIssue (undefined if not set)
 * @param {number|undefined} previousEngagementCount - Current engagementCount (undefined if not set)
 * @param {number} incomingIssueNumber - The issue number from the engagement event
 * @returns {{ lastEngagedIssue: number, engagementCount: number }} Updated state
 */
function applyEngagementUpdate(previousLastEngagedIssue, previousEngagementCount, incomingIssueNumber) {
  // Simulate: attribute_not_exists(lastEngagedIssue) OR lastEngagedIssue < :issueNumber
  const conditionPasses =
    previousLastEngagedIssue === undefined || previousLastEngagedIssue < incomingIssueNumber;

  if (conditionPasses) {
    // SET lastEngagedIssue = :issueNumber ADD engagementCount :one
    // DynamoDB ADD on a non-existent attribute initializes it to the value (1 in this case)
    return {
      lastEngagedIssue: incomingIssueNumber,
      engagementCount: (previousEngagementCount ?? 0) + 1
    };
  }

  // ConditionalCheckFailedException — no change
  return {
    lastEngagedIssue: previousLastEngagedIssue,
    engagementCount: previousEngagementCount ?? 0
  };
}

describe('Property 1: Engagement update preserves monotonic lastEngagedIssue and correct engagementCount', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 5.1, 5.2, 5.3**
   */
  test('lastEngagedIssue equals max(previous, incoming) and engagementCount increments correctly', () => {
    const arbitraryPreviousLastEngagedIssue = fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined });
    const arbitraryPreviousEngagementCount = fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined });
    const arbitraryIncomingIssueNumber = fc.integer({ min: 1, max: 1000 });

    fc.assert(
      fc.property(
        arbitraryPreviousLastEngagedIssue,
        arbitraryPreviousEngagementCount,
        arbitraryIncomingIssueNumber,
        (previousLastEngagedIssue, previousEngagementCount, incomingIssueNumber) => {
          const result = applyEngagementUpdate(previousLastEngagedIssue, previousEngagementCount, incomingIssueNumber);

          // Assert: lastEngagedIssue === max(previous, incoming) or incoming if no previous
          if (previousLastEngagedIssue === undefined) {
            expect(result.lastEngagedIssue).toBe(incomingIssueNumber);
          } else {
            expect(result.lastEngagedIssue).toBe(Math.max(previousLastEngagedIssue, incomingIssueNumber));
          }

          // Assert: engagementCount increments by 1 iff incoming > previous (or no previous)
          const prevCount = previousEngagementCount ?? 0;
          if (previousLastEngagedIssue === undefined || incomingIssueNumber > previousLastEngagedIssue) {
            expect(result.engagementCount).toBe(prevCount + 1);
          } else {
            // Same-issue dedup or out-of-order: unchanged
            expect(result.engagementCount).toBe(prevCount);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
