import fc from 'fast-check';
import {
  computeBaseline,
  computeRecommendedPrice,
  clampMultiplier,
  applySmoothing,
  determineConfidence,
  computeMetricAverages,
  computeCadenceStats,
  buildTrendSummary,
  computeSubscriberGrowthRate,
  computeWeeklyWindow,
  validateLlmResponse
} from '../utils/pricing.mjs';

// Feature: sponsorship-pricing-calculator, Property 1: Deterministic baseline computation
describe('Property 1: Deterministic baseline computation', () => {
  // **Validates: Requirements 1.2**

  it('baseline includes click-rate engagement weighting for any valid inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        (subscriberCount, avgOpenRate, avgClickRate, cpmRate, clickWeight) => {
          const result = computeBaseline(subscriberCount, avgOpenRate, avgClickRate, cpmRate, clickWeight);
          const cpmPrice = (subscriberCount * avgOpenRate / 1000) * cpmRate * (1 + (avgClickRate * clickWeight));
          const floor = subscriberCount * 0.05;
          const expected = Math.max(cpmPrice, floor);
          expect(result).toBeCloseTo(expected, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('higher CTR increases baseline when clickWeight is positive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 5, noNaN: true }),
        (subscriberCount, avgOpenRate, cpmRate, ctr1, ctr2, clickWeight) => {
          const lowCtr = Math.min(ctr1, ctr2);
          const highCtr = Math.max(ctr1, ctr2);
          const baseline1 = computeBaseline(subscriberCount, avgOpenRate, lowCtr, cpmRate, clickWeight);
          const baseline2 = computeBaseline(subscriberCount, avgOpenRate, highCtr, cpmRate, clickWeight);
          expect(baseline2).toBeGreaterThanOrEqual(baseline1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: sponsorship-pricing-calculator, Property 2: Recommended price equals baseline times multiplier
describe('Property 2: Recommended price equals baseline times multiplier', () => {
  // **Validates: Requirements 1.3**

  it('price = baseline × multiplier for any baseline > 0 and multiplier > 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 10_000, noNaN: true }),
        fc.double({ min: 0.01, max: 10, noNaN: true }),
        (baseline, multiplier) => {
          const result = computeRecommendedPrice(baseline, multiplier);
          const expected = baseline * multiplier;
          expect(result).toBeCloseTo(expected, 10);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: sponsorship-pricing-calculator, Property 4: Multiplier clamping
describe('Property 4: Multiplier clamping', () => {
  // **Validates: Requirements 1.5, 10.5**

  it('clamped = max(min, min(max, value)) and always within [min, max]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        (value, a, b) => {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          const result = clampMultiplier(value, min, max);
          const expected = Math.max(min, Math.min(max, value));
          expect(result).toBe(expected);
          expect(result).toBeGreaterThanOrEqual(min);
          expect(result).toBeLessThanOrEqual(max);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: sponsorship-pricing-calculator, Property 5: Price smoothing with significance bypass
describe('Property 5: Price smoothing with significance bypass', () => {
  // **Validates: Requirements 11.1, 11.2, 11.3**

  it('if no metric exceeds significance threshold, week-over-week change <= cap%', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: 0, max: 0.24, noNaN: true }),
        fc.double({ min: 0, max: 9, noNaN: true }),
        (previousPrice, newPrice, capPct, subscriberChangePct, openRateChangePts) => {
          const metricChanges = { subscriberChangePct, openRateChangePts };
          const significantThresholds = { subscriberChangePct: 0.25, openRateChangePts: 10 };

          const { smoothedPrice } = applySmoothing(
            previousPrice, newPrice, capPct, metricChanges, significantThresholds
          );

          const maxDelta = previousPrice * capPct;
          expect(Math.abs(smoothedPrice - previousPrice)).toBeLessThanOrEqual(maxDelta + 1e-9);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('if any metric exceeds significance threshold, full change is allowed', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.oneof(
          fc.record({
            subscriberChangePct: fc.double({ min: 0.26, max: 1, noNaN: true }),
            openRateChangePts: fc.double({ min: 0, max: 20, noNaN: true })
          }),
          fc.record({
            subscriberChangePct: fc.double({ min: 0, max: 1, noNaN: true }),
            openRateChangePts: fc.double({ min: 10.01, max: 50, noNaN: true })
          })
        ),
        (previousPrice, newPrice, capPct, metricChanges) => {
          const significantThresholds = { subscriberChangePct: 0.25, openRateChangePts: 10 };

          const { smoothedPrice } = applySmoothing(
            previousPrice, newPrice, capPct, metricChanges, significantThresholds
          );

          expect(smoothedPrice).toBe(newPrice);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('smoothingApplied flag is true only when smoothing caps the change', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: 0, max: 0.24, noNaN: true }),
        fc.double({ min: 0, max: 9, noNaN: true }),
        (previousPrice, newPrice, capPct, subscriberChangePct, openRateChangePts) => {
          const metricChanges = { subscriberChangePct, openRateChangePts };
          const significantThresholds = { subscriberChangePct: 0.25, openRateChangePts: 10 };

          const { smoothedPrice, smoothingApplied } = applySmoothing(
            previousPrice, newPrice, capPct, metricChanges, significantThresholds
          );

          const maxDelta = previousPrice * capPct;
          const delta = Math.abs(newPrice - previousPrice);

          if (delta > maxDelta) {
            expect(smoothingApplied).toBe(true);
            expect(smoothedPrice).not.toBe(newPrice);
          } else {
            expect(smoothingApplied).toBe(false);
            expect(smoothedPrice).toBe(newPrice);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: sponsorship-pricing-calculator, Property 7: Confidence level determination
describe('Property 7: Confidence level determination', () => {
  // **Validates: Requirements 1.7**

  it('confidence is the minimum across all factor levels', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.boolean(),
        fc.boolean(),
        fc.double({ min: 0, max: 0.6, noNaN: true }),
        (publishedIssueCount, metricsComplete, hasQuestionnaire, stabilityCoV) => {
          const result = determineConfidence({
            publishedIssueCount,
            metricsComplete,
            hasQuestionnaire,
            stabilityCoV,
            isFallback: false
          });

          let issueFactor;
          if (publishedIssueCount < 3) issueFactor = 'low';
          else if (publishedIssueCount < 10) issueFactor = 'medium';
          else issueFactor = 'high';

          let metricsFactor;
          if (!metricsComplete) metricsFactor = 'low';
          else if (metricsComplete && hasQuestionnaire) metricsFactor = 'high';
          else metricsFactor = 'medium';

          let stabilityFactor;
          if (stabilityCoV > 0.30) stabilityFactor = 'low';
          else if (stabilityCoV >= 0.15) stabilityFactor = 'medium';
          else stabilityFactor = 'high';

          const levels = ['low', 'medium', 'high'];
          const rank = (l) => levels.indexOf(l);
          const expected = levels[Math.min(rank(issueFactor), rank(metricsFactor), rank(stabilityFactor), rank('high'), rank('high'))];

          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('fallback always yields low', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.boolean(),
        fc.boolean(),
        fc.double({ min: 0, max: 0.6, noNaN: true }),
        (publishedIssueCount, metricsComplete, hasQuestionnaire, stabilityCoV) => {
          const result = determineConfidence({
            publishedIssueCount,
            metricsComplete,
            hasQuestionnaire,
            stabilityCoV,
            isFallback: true
          });
          expect(result).toBe('low');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cadence irregularity or stale data lowers confidence to low', () => {
    expect(determineConfidence({
      publishedIssueCount: 12,
      metricsComplete: true,
      hasQuestionnaire: true,
      stabilityCoV: 0.05,
      isFallback: false,
      isCadenceIrregular: true,
      isDataStale: false
    })).toBe('low');

    expect(determineConfidence({
      publishedIssueCount: 12,
      metricsComplete: true,
      hasQuestionnaire: true,
      stabilityCoV: 0.05,
      isFallback: false,
      isCadenceIrregular: false,
      isDataStale: true
    })).toBe('low');
  });
});

// Feature: sponsorship-pricing-calculator, Property 8: Metric averaging from recent published issues
describe('Property 8: Metric averaging from recent published issues', () => {
  // **Validates: Requirements 8.3, 8.4, 8.5**

  it('averages equal arithmetic mean of min(N, 10) most recent issues', () => {
    const issueArb = fc.record({
      openRate: fc.double({ min: 0, max: 1, noNaN: true }),
      clickRate: fc.double({ min: 0, max: 1, noNaN: true }),
      bounceRate: fc.double({ min: 0, max: 1, noNaN: true }),
      complaintRate: fc.double({ min: 0, max: 0.1, noNaN: true })
    });

    fc.assert(
      fc.property(
        fc.array(issueArb, { minLength: 1, maxLength: 20 }),
        (issues) => {
          const result = computeMetricAverages(issues);
          const recent = issues.slice(0, 10);
          const count = recent.length;

          const expectedOpen = recent.reduce((s, i) => s + i.openRate, 0) / count;
          const expectedClick = recent.reduce((s, i) => s + i.clickRate, 0) / count;
          const expectedBounce = recent.reduce((s, i) => s + i.bounceRate, 0) / count;
          const expectedComplaint = recent.reduce((s, i) => s + i.complaintRate, 0) / count;

          expect(result.avgOpenRate).toBeCloseTo(expectedOpen, 10);
          expect(result.avgClickRate).toBeCloseTo(expectedClick, 10);
          expect(result.avgBounceRate).toBeCloseTo(expectedBounce, 10);
          expect(result.avgComplaintRate).toBeCloseTo(expectedComplaint, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('uses at most 10 issues even when more are provided', () => {
    const issueArb = fc.record({
      openRate: fc.double({ min: 0, max: 1, noNaN: true }),
      clickRate: fc.double({ min: 0, max: 1, noNaN: true }),
      bounceRate: fc.double({ min: 0, max: 1, noNaN: true }),
      complaintRate: fc.double({ min: 0, max: 0.1, noNaN: true })
    });

    fc.assert(
      fc.property(
        fc.array(issueArb, { minLength: 11, maxLength: 20 }),
        (issues) => {
          const result = computeMetricAverages(issues);
          const first10 = issues.slice(0, 10);
          const expectedOpen = first10.reduce((s, i) => s + i.openRate, 0) / 10;
          expect(result.avgOpenRate).toBeCloseTo(expectedOpen, 10);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Trend and cadence helpers', () => {
  it('builds trend summaries from ordered issue metrics', () => {
    const summary = buildTrendSummary([
      { openRate: 0.20, clickRate: 0.02 },
      { openRate: 0.25, clickRate: 0.03 },
      { openRate: 0.30, clickRate: 0.05 }
    ]);

    expect(summary.recentTrend.openRate.first).toBeCloseTo(0.2, 6);
    expect(summary.recentTrend.openRate.last).toBeCloseTo(0.3, 6);
    expect(summary.recentTrend.openRate.slopePerIssue).toBeGreaterThan(0);
    expect(summary.volatility.openRateCoV).toBeGreaterThan(0);
  });

  it('computes cadence stats from publish timestamps', () => {
    const cadence = computeCadenceStats([
      '2025-01-01T00:00:00Z',
      '2025-01-08T00:00:00Z',
      '2025-01-15T00:00:00Z'
    ]);

    expect(cadence.averageDaysBetweenIssues).toBe(7);
    expect(cadence.medianDaysBetweenIssues).toBe(7);
    expect(cadence.cadenceStdDevDays).toBe(0);
  });
});

// Feature: sponsorship-pricing-calculator, Property 9: Subscriber growth rate computation
describe('Property 9: Subscriber growth rate computation', () => {
  // **Validates: Requirements 8.2**

  it('growth rate = (current - previous) / previous', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (currentCount, previousCount) => {
          const result = computeSubscriberGrowthRate(currentCount, previousCount);
          const expected = (currentCount - previousCount) / previousCount;
          expect(result).toBeCloseTo(expected, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns 0 if no previous count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.constantFrom(null, undefined, 0),
        (currentCount, previousCount) => {
          const result = computeSubscriberGrowthRate(currentCount, previousCount);
          expect(result).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: sponsorship-pricing-calculator, Property 11: Weekly calculation window idempotency
describe('Property 11: Weekly calculation window idempotency', () => {
  // **Validates: Requirements 2.5, 6.3, 6.4**

  it('produces a deterministic 7-day interval for any timestamp', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T23:59:59Z'), noInvalidDate: true }),
        (date) => {
          const result = computeWeeklyWindow(date.toISOString());
          const start = new Date(result.start);
          const end = new Date(result.end);

          const diffMs = end.getTime() - start.getTime();
          expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);

          expect(start.getUTCDay()).toBe(3);
          expect(start.getUTCHours()).toBe(15);
          expect(start.getUTCMinutes()).toBe(0);
          expect(start.getUTCSeconds()).toBe(0);
          expect(start.getUTCMilliseconds()).toBe(0);

          expect(end.getUTCDay()).toBe(3);
          expect(end.getUTCHours()).toBe(15);

          expect(date.getTime()).toBeGreaterThanOrEqual(start.getTime());
          expect(date.getTime()).toBeLessThan(end.getTime());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('calling with the same timestamp always returns the same window', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T23:59:59Z'), noInvalidDate: true }),
        (date) => {
          const iso = date.toISOString();
          const result1 = computeWeeklyWindow(iso);
          const result2 = computeWeeklyWindow(iso);
          expect(result1.start).toBe(result2.start);
          expect(result1.end).toBe(result2.end);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: sponsorship-pricing-calculator, Property 3: LLM response JSON schema validation
describe('Property 3: LLM response JSON schema validation', () => {
  // **Validates: Requirements 1.4**

  it('accepts valid LLM responses with multiplier (number), confidence (low|medium|high), justification (string)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('low', 'medium', 'high'),
        fc.constantFrom('low', 'medium', 'high'),
        fc.constantFrom('low', 'medium', 'high'),
        fc.constantFrom('low', 'medium', 'high'),
        fc.constantFrom('broad_consumer', 'prosumer', 'b2b_general', 'b2b_technical', 'exec_operator', 'premium_niche'),
        fc.string({ minLength: 0, maxLength: 200 }),
        (audienceQuality, nicheSpecificity, cadenceHealth, sponsorFit, suggestedBand, justification) => {
          const response = { audienceQuality, nicheSpecificity, cadenceHealth, sponsorFit, suggestedBand, justification };
          const result = validateLlmResponse(response);
          expect(result).toEqual({ valid: true });
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects responses missing required fields, with wrong types, or non-object values', () => {
    const invalidResponseArb = fc.oneof(
      fc.constantFrom(null, undefined, 42, 'string', true, []),
      fc.constant({}),
      // Missing fields
      fc.constant({ audienceQuality: 'high', nicheSpecificity: 'medium' }),
      // Invalid factor rating
      fc.constant({
        audienceQuality: 'very_high', nicheSpecificity: 'medium',
        cadenceHealth: 'high', sponsorFit: 'high',
        suggestedBand: 'b2b_technical', justification: 'test'
      }),
      // Invalid band
      fc.constant({
        audienceQuality: 'high', nicheSpecificity: 'medium',
        cadenceHealth: 'high', sponsorFit: 'high',
        suggestedBand: 'ultra_premium', justification: 'test'
      }),
      // Missing justification
      fc.constant({
        audienceQuality: 'high', nicheSpecificity: 'medium',
        cadenceHealth: 'high', sponsorFit: 'high',
        suggestedBand: 'b2b_technical'
      }),
      // Old schema shape (should be rejected)
      fc.constant({ multiplier: 1.5, confidence: 'high', justification: 'test' })
    );

    fc.assert(
      fc.property(invalidResponseArb, (response) => {
        const result = validateLlmResponse(response);
        expect(result.valid).toBe(false);
        expect(Array.isArray(result.errors)).toBe(true);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
