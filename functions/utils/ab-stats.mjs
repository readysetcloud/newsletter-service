/**
 * Statistical helpers for A/B test winner evaluation (A/B Testing Phase 2).
 *
 * Pure, dependency-free module. Implements a two-proportion z-test used to
 * decide whether one variant's engagement rate (open rate by default, or click
 * rate) beats the other with the configured statistical confidence.
 */

// Abramowitz & Stegun 7.1.26 approximation of the error function. Max error
// ~1.5e-7, which is far tighter than we need for significance thresholds.
const erf = (x) => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);

  return sign * y;
};

/**
 * Standard normal cumulative distribution function.
 * @param {number} z - Z-score.
 * @returns {number} P(Z <= z).
 */
export const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Two-proportion z-test (variant B relative to variant A).
 *
 * @param {number} successesA - Successes (e.g. unique opens) for variant A.
 * @param {number} nA - Sample size (e.g. deliveries) for variant A.
 * @param {number} successesB - Successes for variant B.
 * @param {number} nB - Sample size for variant B.
 * @returns {{ zScore: number, pValue: number }} z-score (positive when B > A)
 *   and the two-tailed p-value. Degenerate inputs return a non-significant
 *   result (z 0, p 1).
 */
export const twoProportionZTest = (successesA, nA, successesB, nB) => {
  if (nA <= 0 || nB <= 0) {
    return { zScore: 0, pValue: 1 };
  }

  const pA = successesA / nA;
  const pB = successesB / nB;
  const pPool = (successesA + successesB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));

  if (!Number.isFinite(se) || se === 0) {
    return { zScore: 0, pValue: 1 };
  }

  const zScore = (pB - pA) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));

  return { zScore, pValue };
};

/**
 * Evaluates an A/B test result and decides the winner.
 *
 * A variant is only declared the winner when (a) both variants have at least
 * `minSamplePerVariant` deliveries and (b) the difference in the win-metric
 * rate is statistically significant at the configured confidence. Otherwise the
 * result is inconclusive (the caller falls back to the control, variant "a").
 *
 * @param {{opens?: number, clicks?: number, deliveries?: number}} a - Variant A counters.
 * @param {{opens?: number, clicks?: number, deliveries?: number}} b - Variant B counters.
 * @param {{winMetric?: string, confidence?: number, minSamplePerVariant?: number}} opts
 * @returns {{significant: boolean, winnerVariantId: ("a"|"b"|null), status: ("sent"|"inconclusive"), evaluation: object}}
 */
export const evaluateAbResult = (a, b, opts = {}) => {
  const winMetric = opts.winMetric === 'clickRate' ? 'clickRate' : 'openRate';
  const metricField = winMetric === 'clickRate' ? 'clicks' : 'opens';
  const confidence = typeof opts.confidence === 'number' ? opts.confidence : 0.95;
  const minSamplePerVariant =
    typeof opts.minSamplePerVariant === 'number' ? opts.minSamplePerVariant : 0;

  const successesA = a?.[metricField] || 0;
  const successesB = b?.[metricField] || 0;
  const deliveriesA = a?.deliveries || 0;
  const deliveriesB = b?.deliveries || 0;

  const rateA = deliveriesA > 0 ? successesA / deliveriesA : 0;
  const rateB = deliveriesB > 0 ? successesB / deliveriesB : 0;

  const { zScore, pValue } = twoProportionZTest(
    successesA,
    deliveriesA,
    successesB,
    deliveriesB
  );

  const enoughData =
    deliveriesA >= minSamplePerVariant && deliveriesB >= minSamplePerVariant;
  // Two-tailed test: significant when p-value is within the (1 - confidence)
  // rejection region and the rates actually differ.
  const significant = enoughData && rateA !== rateB && pValue <= 1 - confidence;

  let winnerVariantId = null;
  let status = 'inconclusive';
  if (significant) {
    winnerVariantId = rateB > rateA ? 'b' : 'a';
    status = 'sent';
  }

  const evaluation = {
    winMetric,
    confidence,
    minSamplePerVariant,
    variantA: { successes: successesA, deliveries: deliveriesA, rate: rateA },
    variantB: { successes: successesB, deliveries: deliveriesB, rate: rateB },
    zScore,
    pValue,
    enoughData,
    significant,
    winnerVariantId,
    decidedAt: new Date().toISOString()
  };

  return { significant, winnerVariantId, status, evaluation };
};
