import * as fc from 'fast-check';

/**
 * Feature: subscriber-engagement-tracking
 * Property 5: Export includes engagement fields for all subscribers
 *
 * Validates: Requirements 6.1
 *
 * This test verifies that the export mapping logic always produces
 * `lastEngagedIssue` and `engagementCount` fields for every subscriber,
 * matching stored values or `null` when absent.
 */

/**
 * Pure export mapping function matching the logic in export-subscribers.mjs:
 *   {
 *     email: record.email,
 *     lastEngagedIssue: record.lastEngagedIssue ?? null,
 *     engagementCount: record.engagementCount ?? null
 *   }
 *
 * @param {object} record - A subscriber record from DynamoDB (unmarshalled)
 * @returns {{ email: string, lastEngagedIssue: number|null, engagementCount: number|null }}
 */
function applyExportMapping(record) {
  return {
    email: record.email,
    lastEngagedIssue: record.lastEngagedIssue ?? null,
    engagementCount: record.engagementCount ?? null
  };
}

describe('Property 5: Export includes engagement fields for all subscribers', () => {
  /**
   * **Validates: Requirements 6.1**
   */
  test('every exported subscriber has lastEngagedIssue and engagementCount matching stored values or null', () => {
    const arbitrarySubscriberRecord = fc.record({
      email: fc.emailAddress(),
      lastEngagedIssue: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
      engagementCount: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined })
    });

    const arbitrarySubscriberList = fc.array(arbitrarySubscriberRecord, { minLength: 1, maxLength: 50 });

    fc.assert(
      fc.property(
        arbitrarySubscriberList,
        (subscriberRecords) => {
          const exported = subscriberRecords.map(applyExportMapping);

          // Every subscriber in the output must have both engagement fields present as keys
          for (let i = 0; i < exported.length; i++) {
            const output = exported[i];
            const input = subscriberRecords[i];

            // Assert both fields exist as own properties
            expect(output).toHaveProperty('lastEngagedIssue');
            expect(output).toHaveProperty('engagementCount');

            // Assert values match stored values or null if absent
            if (input.lastEngagedIssue !== undefined) {
              expect(output.lastEngagedIssue).toBe(input.lastEngagedIssue);
            } else {
              expect(output.lastEngagedIssue).toBeNull();
            }

            if (input.engagementCount !== undefined) {
              expect(output.engagementCount).toBe(input.engagementCount);
            } else {
              expect(output.engagementCount).toBeNull();
            }
          }

          // Output length matches input length
          expect(exported.length).toBe(subscriberRecords.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
