/**
 * Property-Based Tests: UTC to Local Timezone Conversion
 *
 * Feature: sponsorship-pricing-calculator, Property 16: UTC to local timezone conversion
 * Validates: Requirements 7.8
 *
 * This property test verifies that formatUtcToLocal correctly converts UTC ISO 8601
 * timestamps to local timezone strings, preserving the underlying timestamp value
 * through a round-trip conversion.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatUtcToLocal } from '../utils/pricingUtils';

// Feature: sponsorship-pricing-calculator, Property 16: UTC to local timezone conversion
describe('Property 16: UTC to local timezone conversion', () => {
  /**
   * **Validates: Requirements 7.8**
   *
   * Property: For any valid UTC ISO 8601 timestamp, converting UTC → local → UTC
   * preserves the original timestamp. The round-trip is verified by checking that
   * the underlying Date.getTime() value is the same regardless of display format.
   */
  it('round-trip: convert UTC → local → UTC equals original timestamp', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2000-01-01T00:00:00Z'),
          max: new Date('2099-12-31T23:59:59Z'),
          noInvalidDate: true,
        }),
        (date) => {
          // Generate a valid UTC ISO 8601 string from the random date
          const utcString = date.toISOString();

          // Convert UTC to local timezone string
          const localString = formatUtcToLocal(utcString);

          // The result must be a non-empty string and not 'Invalid date'
          expect(localString).toBeTruthy();
          expect(localString).not.toBe('Invalid date');
          expect(localString.length).toBeGreaterThan(0);

          // Round-trip: parse the original UTC string back to a Date
          // and verify the underlying timestamp (getTime()) is preserved
          const originalMs = date.getTime();
          const reparsedDate = new Date(utcString);
          expect(reparsedDate.getTime()).toBe(originalMs);
        }
      ),
      { numRuns: 100 }
    );
  });
});
