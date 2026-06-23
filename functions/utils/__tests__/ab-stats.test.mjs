/**
 * Unit tests for A/B test winner evaluation statistics.
 */

import {
  normalCdf,
  twoProportionZTest,
  evaluateAbResult
} from '../ab-stats.mjs';

describe('normalCdf', () => {
  it('is ~0.5 at z = 0', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
  });

  it('is ~0.975 at z = 1.96', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it('is ~0.84 at z = 1.0', () => {
    expect(normalCdf(1.0)).toBeCloseTo(0.8413, 2);
  });

  it('is symmetric: cdf(-z) ≈ 1 - cdf(z)', () => {
    expect(normalCdf(-1.0)).toBeCloseTo(1 - normalCdf(1.0), 3);
  });
});

describe('twoProportionZTest', () => {
  it('returns z≈0 and p≈1 for equal proportions', () => {
    const { zScore, pValue } = twoProportionZTest(50, 100, 50, 100);
    expect(zScore).toBeCloseTo(0, 6);
    expect(pValue).toBeCloseTo(1, 6);
  });

  it('returns a small p-value for a large clear difference with big n', () => {
    // A: 30% over 5000, B: 50% over 5000 — a huge, unambiguous gap.
    const { zScore, pValue } = twoProportionZTest(1500, 5000, 2500, 5000);
    expect(pValue).toBeLessThan(0.0001);
    expect(zScore).toBeGreaterThan(0);
  });

  it('returns positive z when B > A', () => {
    const { zScore } = twoProportionZTest(100, 1000, 200, 1000);
    expect(zScore).toBeGreaterThan(0);
  });

  it('returns negative z when A > B', () => {
    const { zScore } = twoProportionZTest(200, 1000, 100, 1000);
    expect(zScore).toBeLessThan(0);
  });

  it('returns the degenerate non-significant result when n is 0', () => {
    expect(twoProportionZTest(0, 0, 0, 0)).toEqual({ zScore: 0, pValue: 1 });
    expect(twoProportionZTest(5, 0, 5, 100)).toEqual({ zScore: 0, pValue: 1 });
    expect(twoProportionZTest(5, 100, 5, 0)).toEqual({ zScore: 0, pValue: 1 });
  });

  it('returns the degenerate result when standard error is 0 (all-zero successes)', () => {
    expect(twoProportionZTest(0, 100, 0, 100)).toEqual({ zScore: 0, pValue: 1 });
  });
});

describe('evaluateAbResult', () => {
  it('declares B the winner with large samples, enough data, and high confidence', () => {
    const a = { opens: 1500, clicks: 200, deliveries: 5000 };
    const b = { opens: 2500, clicks: 400, deliveries: 5000 };
    const result = evaluateAbResult(a, b, {
      winMetric: 'openRate',
      confidence: 0.95,
      minSamplePerVariant: 1000
    });

    expect(result.significant).toBe(true);
    expect(result.winnerVariantId).toBe('b');
    expect(result.status).toBe('sent');
  });

  it('is inconclusive below minSamplePerVariant even with a big rate gap', () => {
    // Big rate difference but tiny samples below the minimum threshold.
    const a = { opens: 3, clicks: 0, deliveries: 10 };
    const b = { opens: 9, clicks: 0, deliveries: 10 };
    const result = evaluateAbResult(a, b, {
      winMetric: 'openRate',
      confidence: 0.95,
      minSamplePerVariant: 1000
    });

    expect(result.significant).toBe(false);
    expect(result.winnerVariantId).toBeNull();
    expect(result.status).toBe('inconclusive');
    expect(result.evaluation.enoughData).toBe(false);
  });

  it('is inconclusive for a tiny insignificant difference', () => {
    // Nearly identical rates over large samples -> not significant.
    const a = { opens: 2500, clicks: 500, deliveries: 5000 };
    const b = { opens: 2510, clicks: 505, deliveries: 5000 };
    const result = evaluateAbResult(a, b, {
      winMetric: 'openRate',
      confidence: 0.95,
      minSamplePerVariant: 1000
    });

    expect(result.significant).toBe(false);
    expect(result.winnerVariantId).toBeNull();
    expect(result.status).toBe('inconclusive');
  });

  it("uses clicks not opens when winMetric is 'clickRate'", () => {
    // Opens are identical; only clicks differ strongly. Under clickRate this
    // is a clear B win; under openRate it would be inconclusive.
    const a = { opens: 4000, clicks: 500, deliveries: 5000 };
    const b = { opens: 4000, clicks: 1500, deliveries: 5000 };

    const click = evaluateAbResult(a, b, {
      winMetric: 'clickRate',
      confidence: 0.95,
      minSamplePerVariant: 1000
    });
    expect(click.evaluation.winMetric).toBe('clickRate');
    expect(click.significant).toBe(true);
    expect(click.winnerVariantId).toBe('b');
    expect(click.evaluation.variantA.successes).toBe(500);
    expect(click.evaluation.variantB.successes).toBe(1500);

    const open = evaluateAbResult(a, b, {
      winMetric: 'openRate',
      confidence: 0.95,
      minSamplePerVariant: 1000
    });
    expect(open.significant).toBe(false);
    expect(open.winnerVariantId).toBeNull();
    expect(open.evaluation.variantA.successes).toBe(4000);
    expect(open.evaluation.variantB.successes).toBe(4000);
  });

  it('exposes the expected evaluation fields', () => {
    const a = { opens: 1500, clicks: 200, deliveries: 5000 };
    const b = { opens: 2500, clicks: 400, deliveries: 5000 };
    const { evaluation } = evaluateAbResult(a, b, {
      winMetric: 'openRate',
      confidence: 0.95,
      minSamplePerVariant: 1000
    });

    expect(typeof evaluation.zScore).toBe('number');
    expect(typeof evaluation.pValue).toBe('number');
    expect(evaluation.variantA).toMatchObject({
      successes: 1500,
      deliveries: 5000
    });
    expect(evaluation.variantB).toMatchObject({
      successes: 2500,
      deliveries: 5000
    });
    expect(evaluation.variantA.rate).toBeCloseTo(0.3, 6);
    expect(evaluation.variantB.rate).toBeCloseTo(0.5, 6);
  });

  it('defaults to openRate and missing counters as zero', () => {
    const result = evaluateAbResult({}, {}, { minSamplePerVariant: 0 });
    expect(result.evaluation.winMetric).toBe('openRate');
    expect(result.evaluation.variantA).toEqual({
      successes: 0,
      deliveries: 0,
      rate: 0
    });
    expect(result.winnerVariantId).toBeNull();
    expect(result.status).toBe('inconclusive');
  });
});
