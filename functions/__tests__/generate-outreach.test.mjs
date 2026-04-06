import * as fc from 'fast-check';
import {
  formatMetrics,
  computeNextPublicationDates,
  buildTemplateFallback,
  computeTotalRevenue
} from '../generate-outreach.mjs';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------
// Property 20: Outreach metrics formatting (Task 7.3)
// ---------------------------------------------------------------------------

describe('Property 20: Outreach metrics formatting', () => {
  /**
   * **Validates: Requirements 6.9**
   *
   * For any subscriber count (positive integer), rate in [0,1], and price
   * (positive number), formatMetrics shall produce:
   * - subscriber count with thousands separators (comma for values >= 1000)
   * - rates as percentages ending with %
   * - prices as USD currency with 2 decimal places starting with $
   */
  test('subscriber count has thousands separators for values >= 1000', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 1_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 10000, noNaN: true }),
        (subscriberCount, rate, price) => {
          const { formattedSubscribers } = formatMetrics(subscriberCount, rate, price);
          expect(formattedSubscribers).toContain(',');
          // Removing commas should recover the original number
          const parsed = Number(formattedSubscribers.replace(/,/g, ''));
          expect(parsed).toBe(subscriberCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('rates are formatted as X.Y% (ends with %)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 10000, noNaN: true }),
        (subscriberCount, rate, price) => {
          const { formattedRate } = formatMetrics(subscriberCount, rate, price);
          expect(formattedRate).toMatch(/%$/);
          // Should have exactly 1 decimal place before %
          expect(formattedRate).toMatch(/^\d+\.\d%$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('prices are formatted with 2 decimal places', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 10000, noNaN: true }),
        (subscriberCount, rate, price) => {
          const { formattedPrice } = formatMetrics(subscriberCount, rate, price);
          // Should have exactly 2 decimal places
          expect(formattedPrice).toMatch(/\.\d{2}$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 21: Next publication date computation (Task 7.4)
// ---------------------------------------------------------------------------

describe('Property 21: Next publication date computation', () => {
  /**
   * **Validates: Requirements 10.5**
   *
   * For any preferred day of week and publishing interval (Weekly/Biweekly/Monthly),
   * the computed next 3 publication dates shall all fall on the specified day of week,
   * be in the future relative to the reference date, and be correctly spaced.
   */
  const arbDayOfWeek = fc.constantFrom(...DAYS_OF_WEEK);
  const arbInterval = fc.constantFrom('Weekly', 'Biweekly', 'Monthly');
  // Reference dates within a reasonable range, filtered to avoid NaN
  const arbReferenceDate = fc.date({
    min: new Date('2020-01-01'),
    max: new Date('2030-12-31')
  }).filter(d => !isNaN(d.getTime()));

  test('all 3 dates fall on the correct day of week', () => {
    fc.assert(
      fc.property(arbDayOfWeek, arbInterval, arbReferenceDate, (day, interval, refDate) => {
        const dates = computeNextPublicationDates(day, interval, refDate);
        expect(dates).toHaveLength(3);
        const targetIndex = DAYS_OF_WEEK.indexOf(day);
        for (const d of dates) {
          expect(d.getDay()).toBe(targetIndex);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('all 3 dates are in the future relative to reference date', () => {
    fc.assert(
      fc.property(arbDayOfWeek, arbInterval, arbReferenceDate, (day, interval, refDate) => {
        const dates = computeNextPublicationDates(day, interval, refDate);
        expect(dates).toHaveLength(3);
        // Compare using UTC calendar dates to avoid timezone issues
        const refUTC = Date.UTC(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
        for (const d of dates) {
          const dUTC = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
          expect(dUTC).toBeGreaterThan(refUTC);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('dates are correctly spaced (7/14/28 days)', () => {
    const expectedSpacing = { Weekly: 7, Biweekly: 14, Monthly: 28 };

    // Helper to compute calendar day difference (DST-safe)
    function calendarDayDiff(a, b) {
      const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
      const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
      return (utcB - utcA) / (24 * 60 * 60 * 1000);
    }

    fc.assert(
      fc.property(arbDayOfWeek, arbInterval, arbReferenceDate, (day, interval, refDate) => {
        const dates = computeNextPublicationDates(day, interval, refDate);
        expect(dates).toHaveLength(3);
        const spacingDays = expectedSpacing[interval];
        for (let i = 1; i < dates.length; i++) {
          const diff = calendarDayDiff(dates[i - 1], dates[i]);
          expect(diff).toBe(spacingDays);
        }
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 22: Cadence omission when not set or irregular (Task 7.5)
// ---------------------------------------------------------------------------

describe('Property 22: Cadence omission when not set or irregular', () => {
  /**
   * **Validates: Requirements 10.4, 10.7**
   *
   * When cadence is null or interval is "Irregular",
   * computeNextPublicationDates returns an empty array.
   */
  test('returns empty array when cadence is null', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DAYS_OF_WEEK),
        (day) => {
          const dates = computeNextPublicationDates(day, null);
          expect(dates).toEqual([]);
        }
      ),
      { numRuns: 20 }
    );
  });

  test('returns empty array when interval is "Irregular"', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DAYS_OF_WEEK),
        (day) => {
          const dates = computeNextPublicationDates(day, 'Irregular');
          expect(dates).toEqual([]);
        }
      ),
      { numRuns: 20 }
    );
  });

  test('returns empty array when dayOfWeek is null', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Weekly', 'Biweekly', 'Monthly'),
        (interval) => {
          const dates = computeNextPublicationDates(null, interval);
          expect(dates).toEqual([]);
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 19: Template fallback produces valid email (Task 7.6)
// ---------------------------------------------------------------------------

describe('Property 19: Template fallback produces valid email', () => {
  /**
   * **Validates: Requirements 6.7**
   *
   * For any Sponsor_Record with contactName and sponsorName, and any
   * Pricing_Record with subscriberCount > 0 and openRate in [0,1],
   * the template fallback shall produce an email with a non-empty subject,
   * and a body containing the contact name, subscriber count, and price.
   */
  test('produces email with contact name, subscriber count, and price in body', () => {
    const arbSponsor = fc.record({
      contactName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      sponsorName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)
    });
    const arbPricing = fc.record({
      subscriberCount: fc.integer({ min: 1, max: 1_000_000 }),
      openRate: fc.double({ min: 0, max: 1, noNaN: true }),
      recommendedPrice: fc.double({ min: 0.01, max: 10000, noNaN: true })
    });

    fc.assert(
      fc.property(arbSponsor, arbPricing, (sponsor, pricing) => {
        const result = buildTemplateFallback(sponsor, pricing, [], null);

        // Non-empty subject
        expect(result.subject.length).toBeGreaterThan(0);

        // Body contains contact name
        expect(result.body).toContain(sponsor.contactName);

        // Body contains formatted subscriber count
        const { formattedSubscribers, formattedPrice } = formatMetrics(
          pricing.subscriberCount,
          pricing.openRate,
          pricing.recommendedPrice
        );
        expect(result.body).toContain(formattedSubscribers);

        // Body contains formatted price
        expect(result.body).toContain(formattedPrice);
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 16: Outreach email excludes internal data (Task 7.7)
// ---------------------------------------------------------------------------

describe('Property 16: Outreach email excludes internal data', () => {
  /**
   * **Validates: Requirements 6.6**
   *
   * For any generated template email, the output shall NOT contain
   * internal field values: multipliers, baselinePrice, confidenceJustification,
   * bounceRate, complaintRate.
   */
  test('template output does not contain internal pricing fields', () => {
    const arbSponsor = fc.record({
      contactName: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
      sponsorName: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0)
    });

    const arbPricing = fc.record({
      subscriberCount: fc.integer({ min: 1, max: 1_000_000 }),
      openRate: fc.double({ min: 0.01, max: 1, noNaN: true }),
      recommendedPrice: fc.double({ min: 1, max: 10000, noNaN: true }),
      // Internal fields that should NOT appear in output
      multiplier: fc.double({ min: 0.5, max: 3.0, noNaN: true }),
      baselinePrice: fc.double({ min: 10, max: 5000, noNaN: true }),
      confidenceJustification: fc.string({ minLength: 10, maxLength: 200 }).filter(s => s.trim().length >= 10),
      bounceRate: fc.double({ min: 0.001, max: 0.5, noNaN: true }),
      complaintRate: fc.double({ min: 0.0001, max: 0.1, noNaN: true })
    });

    fc.assert(
      fc.property(arbSponsor, arbPricing, (sponsor, pricing) => {
        const result = buildTemplateFallback(sponsor, pricing, [], null);
        const fullOutput = `${result.subject} ${result.body}`;

        // Internal fields should not appear in the output
        // Check that the specific internal values are not present
        const multiplierStr = pricing.multiplier.toString();
        const baselineStr = pricing.baselinePrice.toFixed(2);
        const bounceStr = (pricing.bounceRate * 100).toFixed(1);
        const complaintStr = (pricing.complaintRate * 100).toFixed(1);

        // Only check if the string is long enough to be meaningful (avoid false positives with short numbers)
        if (pricing.confidenceJustification.length >= 10) {
          expect(fullOutput).not.toContain(pricing.confidenceJustification);
        }
        if (multiplierStr.length > 3) {
          expect(fullOutput).not.toContain(multiplierStr);
        }
        if (baselineStr.length > 4) {
          expect(fullOutput).not.toContain(baselineStr);
        }
        if (bounceStr.length > 3 && bounceStr !== (pricing.openRate * 100).toFixed(1)) {
          expect(fullOutput).not.toContain(`${bounceStr}%`);
        }
        if (complaintStr.length > 3) {
          expect(fullOutput).not.toContain(`${complaintStr}%`);
        }
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 18: Outreach record completeness (Task 7.8)
// ---------------------------------------------------------------------------

describe('Property 18: Outreach record completeness', () => {
  /**
   * **Validates: Requirements 7.1, 9.2**
   *
   * buildTemplateFallback returns an object with non-empty subject and body fields.
   */
  test('returns object with non-empty subject and body', () => {
    const arbSponsor = fc.record({
      contactName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      sponsorName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)
    });
    const arbPricing = fc.record({
      subscriberCount: fc.integer({ min: 1, max: 1_000_000 }),
      openRate: fc.double({ min: 0, max: 1, noNaN: true }),
      recommendedPrice: fc.double({ min: 0.01, max: 10000, noNaN: true })
    });
    const arbHistory = fc.array(
      fc.record({
        status: fc.constantFrom('draft', 'booked', 'fulfilled', 'cancelled'),
        amountCharged: fc.double({ min: 1, max: 10000, noNaN: true }),
        sponsorshipDate: fc.constant('2025-01-15')
      }),
      { minLength: 0, maxLength: 10 }
    );
    const arbCadence = fc.option(
      fc.record({
        publishingDayOfWeek: fc.constantFrom(...DAYS_OF_WEEK),
        publishingInterval: fc.constantFrom('Weekly', 'Biweekly', 'Monthly', 'Irregular')
      }),
      { nil: null }
    );

    fc.assert(
      fc.property(arbSponsor, arbPricing, arbHistory, arbCadence, (sponsor, pricing, history, cadence) => {
        const result = buildTemplateFallback(sponsor, pricing, history, cadence);

        expect(result).toHaveProperty('subject');
        expect(result).toHaveProperty('body');
        expect(typeof result.subject).toBe('string');
        expect(typeof result.body).toBe('string');
        expect(result.subject.length).toBeGreaterThan(0);
        expect(result.body.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 10: Total revenue computation (Task 7.9)
// ---------------------------------------------------------------------------

describe('Property 10: Total revenue computation', () => {
  /**
   * **Validates: Requirements 3.7, 8.4**
   *
   * For any list of 0–20 entries with random statuses and amounts,
   * total revenue equals the sum of amountCharged where status is "fulfilled".
   */
  test('total equals sum of amountCharged where status is fulfilled', () => {
    const arbEntry = fc.record({
      status: fc.constantFrom('draft', 'booked', 'fulfilled', 'cancelled'),
      amountCharged: fc.double({ min: 0.01, max: 10000, noNaN: true })
    });
    const arbEntries = fc.array(arbEntry, { minLength: 0, maxLength: 20 });

    fc.assert(
      fc.property(arbEntries, (entries) => {
        const result = computeTotalRevenue(entries);

        // Manually compute expected total
        const expected = entries
          .filter(e => e.status === 'fulfilled')
          .reduce((sum, e) => sum + e.amountCharged, 0);

        expect(result).toBeCloseTo(expected, 10);
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 14: Unique click computation (Task 7.10)
// ---------------------------------------------------------------------------

describe('Property 14: Unique click computation', () => {
  /**
   * **Validates: Requirements 4.8**
   *
   * Given random lists of 0–100 click events with random subscriberEmailHash values,
   * unique count = distinct hashes, total count = event count, unique <= total.
   * Tests the pure logic directly (not the DynamoDB query).
   */

  /**
   * Pure logic extracted from the click computation algorithm:
   * Given a list of click events, compute total and unique counts.
   */
  function computeClicksFromEvents(events) {
    const uniqueHashes = new Set();
    for (const event of events) {
      if (event.subscriberEmailHash && event.subscriberEmailHash !== 'unknown') {
        uniqueHashes.add(event.subscriberEmailHash);
      }
    }
    return {
      totalClicks: events.length,
      uniqueClicks: uniqueHashes.size
    };
  }

  test('unique count equals distinct hashes, total equals event count, unique <= total', () => {
    const arbEvent = fc.record({
      subscriberEmailHash: fc.oneof(
        fc.stringMatching(/^[a-f0-9]{8,64}$/),
        fc.constant('unknown')
      )
    });
    const arbEvents = fc.array(arbEvent, { minLength: 0, maxLength: 100 });

    fc.assert(
      fc.property(arbEvents, (events) => {
        const result = computeClicksFromEvents(events);

        // Total count = number of events
        expect(result.totalClicks).toBe(events.length);

        // Unique count = distinct non-unknown hashes
        const expectedUnique = new Set(
          events
            .map(e => e.subscriberEmailHash)
            .filter(h => h && h !== 'unknown')
        ).size;
        expect(result.uniqueClicks).toBe(expectedUnique);

        // Unique <= total
        expect(result.uniqueClicks).toBeLessThanOrEqual(result.totalClicks);
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 23: Outreach prefers sponsor-specific metrics (Task 7.11)
// ---------------------------------------------------------------------------

describe('Property 23: Outreach prefers sponsor-specific metrics', () => {
  /**
   * **Validates: Requirements 4.7, 6.11**
   *
   * When click data exists (totalClicks > 0) → metricsSource is "sponsor-specific",
   * otherwise → metricsSource is "general".
   */

  /**
   * Pure metricsSource logic extracted from the handler:
   * determines whether to use sponsor-specific or general metrics.
   */
  function determineMetricsSource(clickTotals) {
    const hasClickData = clickTotals.totalClicks > 0;
    return hasClickData ? 'sponsor-specific' : 'general';
  }

  test('metricsSource is sponsor-specific when totalClicks > 0, general otherwise', () => {
    const arbClickTotals = fc.record({
      totalClicks: fc.integer({ min: 0, max: 10000 }),
      uniqueClicks: fc.integer({ min: 0, max: 10000 })
    }).filter(ct => ct.uniqueClicks <= ct.totalClicks);

    fc.assert(
      fc.property(arbClickTotals, (clickTotals) => {
        const source = determineMetricsSource(clickTotals);

        if (clickTotals.totalClicks > 0) {
          expect(source).toBe('sponsor-specific');
        } else {
          expect(source).toBe('general');
        }
      }),
      { numRuns: 100 }
    );
  });
});
