/**
 * Pricing utility functions for the Sponsorship Pricing Calculator.
 *
 * Pure, deterministic helpers used by calculate-pricing and weekly-pricing-job Lambdas.
 */

/**
 * Compute the deterministic CPM-based baseline price.
 * baseline = (subscriberCount × avgOpenRate / 1000) × cpmRate
 *
 * @param {number} subscriberCount - Total subscriber count (must be > 0)
 * @param {number} avgOpenRate - Average open rate in [0, 1]
 * @param {number} cpmRate - Cost per thousand impressions
 * @returns {number} Baseline price in USD
 */
export function computeBaseline(subscriberCount, avgOpenRate, cpmRate) {
  return (subscriberCount * avgOpenRate / 1000) * cpmRate;
}

/**
 * Clamp a multiplier value to [min, max].
 *
 * @param {number} value - Raw multiplier
 * @param {number} min - Lower bound
 * @param {number} max - Upper bound
 * @returns {number} Clamped multiplier
 */
export function clampMultiplier(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Apply week-over-week price smoothing.
 *
 * If any metric change exceeds its significance threshold the full change is
 * allowed. Otherwise the change is capped to capPct of the previous price.
 *
 * @param {number} previousPrice - Last week's recommended price
 * @param {number} newPrice - Newly computed recommended price
 * @param {number} capPct - Maximum allowed change as a fraction (e.g. 0.20)
 * @param {Object} metricChanges - Observed metric deltas
 * @param {number} [metricChanges.subscriberChangePct] - Subscriber count % change
 * @param {number} [metricChanges.openRateChangePts] - Open rate change in percentage points
 * @param {Object} significantThresholds - Thresholds that bypass smoothing
 * @param {number} significantThresholds.subscriberChangePct - e.g. 0.25
 * @param {number} significantThresholds.openRateChangePts - e.g. 10
 * @returns {{ smoothedPrice: number, smoothingApplied: boolean }}
 */
export function applySmoothing(previousPrice, newPrice, capPct, metricChanges, significantThresholds) {
  // No previous price → no smoothing possible
  if (previousPrice == null || previousPrice === 0) {
    return { smoothedPrice: newPrice, smoothingApplied: false };
  }

  // Check if any metric exceeds significance threshold → allow full change
  const significantChange =
    (metricChanges.subscriberChangePct != null &&
      Math.abs(metricChanges.subscriberChangePct) > significantThresholds.subscriberChangePct) ||
    (metricChanges.openRateChangePts != null &&
      Math.abs(metricChanges.openRateChangePts) > significantThresholds.openRateChangePts);

  if (significantChange) {
    return { smoothedPrice: newPrice, smoothingApplied: false };
  }

  // Cap the change to capPct of previous price
  const maxDelta = previousPrice * capPct;
  const delta = newPrice - previousPrice;

  if (Math.abs(delta) <= maxDelta) {
    return { smoothedPrice: newPrice, smoothingApplied: false };
  }

  const smoothedPrice = previousPrice + Math.sign(delta) * maxDelta;
  return { smoothedPrice, smoothingApplied: true };
}

/**
 * Determine confidence level based on multiple factors.
 *
 * The final confidence is the minimum across all individual factor levels.
 *
 * | Factor                  | Low              | Medium          | High                              |
 * |-------------------------|------------------|-----------------|-----------------------------------|
 * | Published issue count   | < 3              | 3–9             | ≥ 10                              |
 * | Metrics completeness    | missing key      | all core        | all metrics + questionnaire       |
 * | Metric stability (CoV)  | > 30%            | 15%–30%         | < 15%                             |
 * | Fallback                | always low       | —               | —                                 |
 *
 * @param {number} publishedIssueCount
 * @param {boolean} metricsComplete - All core metrics present
 * @param {boolean} hasQuestionnaire - Questionnaire responses present
 * @param {number} stabilityCoV - Coefficient of variation (0–1 scale, e.g. 0.15 = 15%)
 * @param {boolean} isFallback - True if LLM was unavailable
 * @returns {'low' | 'medium' | 'high'}
 */
export function determineConfidence(publishedIssueCount, metricsComplete, hasQuestionnaire, stabilityCoV, isFallback) {
  if (isFallback) return 'low';

  const levels = ['low', 'medium', 'high'];
  const rank = (level) => levels.indexOf(level);
  const minLevel = (...lvls) => levels[Math.min(...lvls.map(rank))];

  // Issue count factor
  let issueFactor;
  if (publishedIssueCount < 3) issueFactor = 'low';
  else if (publishedIssueCount < 10) issueFactor = 'medium';
  else issueFactor = 'high';

  // Metrics completeness factor
  let metricsFactor;
  if (!metricsComplete) metricsFactor = 'low';
  else if (metricsComplete && hasQuestionnaire) metricsFactor = 'high';
  else metricsFactor = 'medium';

  // Stability factor (CoV)
  let stabilityFactor;
  if (stabilityCoV > 0.30) stabilityFactor = 'low';
  else if (stabilityCoV >= 0.15) stabilityFactor = 'medium';
  else stabilityFactor = 'high';

  return minLevel(issueFactor, metricsFactor, stabilityFactor);
}

/**
 * Validate an LLM response against the strict pricing JSON schema.
 *
 * Required shape:
 *   { multiplier: number, confidence: 'low'|'medium'|'high', justification: string }
 *
 * @param {*} json - Parsed JSON to validate
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateLlmResponse(json) {
  const errors = [];

  if (json == null || typeof json !== 'object' || Array.isArray(json)) {
    return { valid: false, errors: ['Response must be a JSON object'] };
  }

  if (typeof json.multiplier !== 'number' || Number.isNaN(json.multiplier)) {
    errors.push('multiplier must be a number');
  }

  const validConfidence = ['low', 'medium', 'high'];
  if (!validConfidence.includes(json.confidence)) {
    errors.push('confidence must be one of: low, medium, high');
  }

  if (typeof json.justification !== 'string') {
    errors.push('justification must be a string');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Compute average open, click, bounce, and complaint rates from the most
 * recent min(N, 10) published issues.
 *
 * Issues should already be sorted by publish date descending.
 *
 * @param {Array<{ openRate: number, clickRate: number, bounceRate: number, complaintRate: number }>} issues
 * @returns {{ avgOpenRate: number, avgClickRate: number, avgBounceRate: number, avgComplaintRate: number }}
 */
export function computeMetricAverages(issues) {
  const recent = issues.slice(0, 10);
  const count = recent.length;

  if (count === 0) {
    return { avgOpenRate: 0, avgClickRate: 0, avgBounceRate: 0, avgComplaintRate: 0 };
  }

  const sum = recent.reduce(
    (acc, issue) => ({
      openRate: acc.openRate + (issue.openRate || 0),
      clickRate: acc.clickRate + (issue.clickRate || 0),
      bounceRate: acc.bounceRate + (issue.bounceRate || 0),
      complaintRate: acc.complaintRate + (issue.complaintRate || 0)
    }),
    { openRate: 0, clickRate: 0, bounceRate: 0, complaintRate: 0 }
  );

  return {
    avgOpenRate: sum.openRate / count,
    avgClickRate: sum.clickRate / count,
    avgBounceRate: sum.bounceRate / count,
    avgComplaintRate: sum.complaintRate / count
  };
}

/**
 * Compute subscriber growth rate.
 *
 * @param {number} currentCount
 * @param {number|null|undefined} previousCount - From the last pricing record; null/0 if none
 * @returns {number} Growth rate (e.g. 0.05 = 5% growth); 0 if no previous
 */
export function computeSubscriberGrowthRate(currentCount, previousCount) {
  if (!previousCount || previousCount === 0) return 0;
  return (currentCount - previousCount) / previousCount;
}

/**
 * Compute the weekly calculation window (Wednesday 3 PM UTC → Wednesday 3 PM UTC)
 * that contains the given timestamp.
 *
 * @param {string|Date} timestamp - ISO 8601 string or Date
 * @returns {{ start: string, end: string }} ISO 8601 start/end of the window
 */
export function computeWeeklyWindow(timestamp) {
  const date = new Date(timestamp);

  // Find the most recent Wednesday 3 PM UTC at or before the timestamp
  const day = date.getUTCDay(); // 0=Sun … 3=Wed … 6=Sat
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();

  // Days since last Wednesday (0 if today is Wednesday and we're at or after 3 PM)
  let daysSinceWed = (day - 3 + 7) % 7;

  // If it's Wednesday but before 3 PM UTC, go back to the previous Wednesday
  if (daysSinceWed === 0) {
    const timeInDay = hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
    if (timeInDay < 15 * 3600000) {
      daysSinceWed = 7;
    }
  }

  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - daysSinceWed);
  start.setUTCHours(15, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

/**
 * Compute the final recommended price.
 *
 * @param {number} baseline - Deterministic baseline price
 * @param {number} multiplier - Adjusted multiplier (after clamping/smoothing)
 * @returns {number} Recommended price in USD
 */
export function computeRecommendedPrice(baseline, multiplier) {
  return baseline * multiplier;
}
