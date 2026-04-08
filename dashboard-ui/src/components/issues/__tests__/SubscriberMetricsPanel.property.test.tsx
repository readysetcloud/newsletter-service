import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { render, screen, within } from '@testing-library/react';
import { SubscriberMetricsPanel } from '../SubscriberMetricsPanel';

/**
 * Property 6: Total loss equals sum of individual counts
 *
 * For any three non-negative integers representing unsubscribes, cleaned,
 * and manualRemovals, the total subscriber loss displayed by the
 * SubscriberMetricsPanel SHALL equal unsubscribes + cleaned + manualRemovals.
 *
 * **Validates: Requirements 4.6**
 */
describe('SubscriberMetricsPanel - Property-Based Tests', () => {
  it('Property 6: Total loss equals sum of individual counts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (unsubscribes, cleaned, manualRemovals) => {
          const expectedTotal = unsubscribes + cleaned + manualRemovals;
          const formattedTotal = expectedTotal.toLocaleString('en-US');

          const { unmount } = render(
            <SubscriberMetricsPanel
              unsubscribes={unsubscribes}
              cleaned={cleaned}
              manualRemovals={manualRemovals}
            />
          );

          const region = screen.getByRole('region', { name: 'Subscriber loss metrics' });
          // The Total Loss card is the last grid child; its formatted value must match
          // the arithmetic sum of the three individual counts.
          const totalLossText = within(region).getAllByText(formattedTotal);
          expect(totalLossText.length).toBeGreaterThanOrEqual(1);

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: Loss percentage calculation
   *
   * For any total loss count and subscribers-at-send-time value where
   * subscribers > 0, the displayed loss percentage SHALL equal
   * (totalLoss / subscribers) * 100 rounded to two decimal places.
   * For any stats where subscribers is 0 or absent, the percentage
   * SHALL be omitted from the display.
   *
   * **Validates: Requirements 4.7**
   */
  it('Property 7: Loss percentage is correctly calculated when subscribers > 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (unsubscribes, cleaned, manualRemovals, subscribers) => {
          const totalLoss = unsubscribes + cleaned + manualRemovals;
          const expectedPercentage = Math.round((totalLoss / subscribers) * 10000) / 100;
          const expectedText = `${expectedPercentage.toFixed(2)}% of subscribers`;

          const { unmount } = render(
            <SubscriberMetricsPanel
              unsubscribes={unsubscribes}
              cleaned={cleaned}
              manualRemovals={manualRemovals}
              subscribers={subscribers}
            />
          );

          const region = screen.getByRole('region', { name: 'Subscriber loss metrics' });
          const percentageElement = within(region).getByText(expectedText);
          expect(percentageElement).toBeTruthy();

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: Loss percentage is omitted when subscribers is 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (unsubscribes, cleaned, manualRemovals) => {
          const { unmount } = render(
            <SubscriberMetricsPanel
              unsubscribes={unsubscribes}
              cleaned={cleaned}
              manualRemovals={manualRemovals}
              subscribers={0}
            />
          );

          const region = screen.getByRole('region', { name: 'Subscriber loss metrics' });
          const percentageMatches = within(region).queryAllByText(/% of subscribers/);
          expect(percentageMatches).toHaveLength(0);

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});
