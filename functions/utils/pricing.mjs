/**
 * Pricing utility functions for the Sponsorship Pricing Calculator.
 *
 * Pure, deterministic helpers used by calculate-pricing and weekly-pricing-job Lambdas.
 */

// ---------------------------------------------------------------------------
// Audience band → CPM table
// ---------------------------------------------------------------------------

const CPM_BANDS = {
  broad_consumer:  15,
  prosumer:        25,
  b2b_general:     35,
  b2b_technical:   50,
  exec_operator:   75,
  premium_niche:   100
};

const DEFAULT_BAND = 'prosumer';

/**
 * Look up the CPM rate for an audience band.
 * Falls back to the prosumer band if the band is unknown.
 */
export function cpmForBand(band) {
  return CPM_BANDS[band] || CPM_BANDS[DEFAULT_BAND];
}

export function getValidBands() {
  return Object.keys(CPM_BANDS);
}

// ---------------------------------------------------------------------------
// Deterministic band classifier (fallback when LLM is unavailable)
// ---------------------------------------------------------------------------

// Maps questionnaire q1 (primary industry) to a likely audience band.
const INDUSTRY_BAND_MAP = {
  'Technology':  'b2b_technical',
  'Finance':     'premium_niche',
  'Marketing':   'b2b_general',
  'Healthcare':  'premium_niche',
  'Education':   'prosumer',
  'Other':       'prosumer'
};

// Keywords in the free-text niche description (q2) that hint at higher-tier bands.
const NICHE_KEYWORDS = {
  exec_operator:  ['founder', 'ceo', 'cto', 'cfo', 'vp ', 'executive', 'c-suite', 'decision-maker', 'operator', 'leader'],
  b2b_technical:  ['engineer', 'developer', 'devops', 'infrastructure', 'software', 'cloud', 'security', 'data science', 'machine learning', 'ai agent', 'serverless', 'architecture'],
  premium_niche:  ['niche', 'specialized', 'premium', 'exclusive', 'high-value', 'legal', 'medical', 'compliance']
};

// Sponsorship format signals (q3): dedicated emails command higher CPMs.
const PREMIUM_FORMATS = ['Dedicated email'];

/**
 * Deterministic band classification from questionnaire responses and metrics.
 *
 * Uses structured questionnaire fields:
 *   q1 = primary industry (single-select)
 *   q2 = niche description (free text)
 *   q3 = sponsorship formats (multi-select)
 *   q4 = publish frequency (single-select)
 *   q5 = monetization goal (single-select)
 */
export function classifyBandFromQuestionnaire(questionnaireResponses, metrics) {
  let band = 'prosumer'; // default

  if (questionnaireResponses && Object.keys(questionnaireResponses).length > 0) {
    const q1 = questionnaireResponses.q1;
    const q2 = typeof questionnaireResponses.q2 === 'string' ? questionnaireResponses.q2.toLowerCase() : '';
    const q3 = Array.isArray(questionnaireResponses.q3) ? questionnaireResponses.q3 : [];

    // Start from industry mapping
    if (q1 && INDUSTRY_BAND_MAP[q1]) {
      band = INDUSTRY_BAND_MAP[q1];
    }

    // Niche keywords can upgrade the band
    for (const [upgradeBand, keywords] of Object.entries(NICHE_KEYWORDS)) {
      if (keywords.some(kw => q2.includes(kw))) {
        const bandOrder = ['broad_consumer', 'prosumer', 'b2b_general', 'b2b_technical', 'exec_operator', 'premium_niche'];
        const currentIdx = bandOrder.indexOf(band);
        const upgradeIdx = bandOrder.indexOf(upgradeBand);
        if (upgradeIdx > currentIdx) {
          band = upgradeBand;
        }
        break;
      }
    }

    // Premium format + revenue-focused goal can nudge up one tier
    const q5 = questionnaireResponses.q5;
    const hasRevenueGoal = q5 === 'Maximize revenue per issue' || q5 === 'Build long-term sponsor relationships';
    if (hasRevenueGoal && q3.some(f => PREMIUM_FORMATS.includes(f))) {
      const bandOrder = ['broad_consumer', 'prosumer', 'b2b_general', 'b2b_technical', 'exec_operator', 'premium_niche'];
      const idx = bandOrder.indexOf(band);
      if (idx < bandOrder.length - 1) {
        band = bandOrder[idx + 1];
      }
    }
  }

  // Metrics-based heuristic when no questionnaire
  if ((!questionnaireResponses || Object.keys(questionnaireResponses).length === 0) && metrics) {
    const openRate = metrics.avgOpenRate ?? 0;
    const clickRate = metrics.avgClickRate ?? 0;
    if (openRate > 0.50 && clickRate > 0.05) band = 'b2b_technical';
    else if (openRate > 0.40) band = 'prosumer';
  }

  return band;
}

/**
 * Build a full deterministic classification (band + factors) from questionnaire and metrics.
 * Used as fallback when the LLM is unavailable.
 */
export function buildDeterministicClassification(questionnaireResponses, metrics, config) {
  const band = classifyBandFromQuestionnaire(questionnaireResponses, metrics);

  // --- cadenceHealth from cadence stats ---
  const cadenceStd = metrics?.cadenceStdDevDays ?? Infinity;
  const threshold = config?.cadenceRegularityThreshold ?? 3;
  let cadenceHealth = 'medium';
  if (cadenceStd <= 1) cadenceHealth = 'high';
  else if (cadenceStd > threshold) cadenceHealth = 'low';

  // --- audienceQuality from open/click vs benchmarks ---
  // DESIGN NOTE: These thresholds will drift as industry benchmarks change.
  // The benchmarks are configurable via pricing-config in DynamoDB. If open
  // rate reliability degrades (e.g., Apple MPP inflation), consider weighting
  // click rate more heavily here.
  const avgOpen = metrics?.avgOpenRate ?? 0;
  const avgClick = metrics?.avgClickRate ?? 0;
  const benchOpen = config?.industryAvgOpenRate ?? 0.4346;
  const benchClick = config?.industryAvgClickRate ?? 0.0209;
  let audienceQuality = 'medium';
  if (avgOpen > benchOpen * 1.2 && avgClick > benchClick * 1.5) audienceQuality = 'high';
  else if (avgOpen < benchOpen * 0.6 || avgClick < benchClick * 0.5) audienceQuality = 'low';

  // --- nicheSpecificity from questionnaire niche description ---
  const q2 = typeof questionnaireResponses?.q2 === 'string' ? questionnaireResponses.q2 : '';
  const q2Lower = q2.toLowerCase();
  let nicheSpecificity = 'medium';
  // Check for niche keywords (same signals used in band classification)
  const hasNicheKeywords = Object.values(NICHE_KEYWORDS)
    .flat()
    .some(kw => q2Lower.includes(kw));
  if (hasNicheKeywords && q2.length > 20) nicheSpecificity = 'high';
  else if (q2.length === 0) nicheSpecificity = 'low';

  // --- sponsorFit from questionnaire + engagement ---
  const q3 = Array.isArray(questionnaireResponses?.q3) ? questionnaireResponses.q3 : [];
  const q5 = questionnaireResponses?.q5;
  let sponsorFit = 'medium';
  if (q3.length >= 2 && (q5 === 'Maximize revenue per issue' || q5 === 'Build long-term sponsor relationships')) {
    sponsorFit = 'high';
  } else if (q3.length === 0 || q5 === 'Grow audience first, monetize later') {
    sponsorFit = 'low';
  }

  return {
    audienceQuality,
    nicheSpecificity,
    cadenceHealth,
    sponsorFit,
    suggestedBand: band,
    justification: `Deterministic classification (band: ${band}). AI classification was unavailable.`
  };
}

// ---------------------------------------------------------------------------
// Band-factor consistency check
// ---------------------------------------------------------------------------

// Expected minimum factor levels for higher-tier bands.
// DESIGN DECISIONS:
// - prosumer and broad_consumer have no constraints intentionally. They are
//   audience identities, not monetization maturity gates. Weak newsletters
//   can "stick" in prosumer — if this becomes a problem, apply soft penalties
//   via the multiplier (factorsToMultiplier) rather than band downgrade.
// - Only 4 bands have constraints. This is deliberate: the reconciliation
//   step is a safety net, not a full classifier. It catches obvious mismatches.
const BAND_FACTOR_EXPECTATIONS = {
  premium_niche:  { nicheSpecificity: 'high' },
  exec_operator:  { audienceQuality: 'high' },
  b2b_technical:  { nicheSpecificity: 'medium' },
  b2b_general:    { audienceQuality: 'medium' }
  // prosumer and broad_consumer have no factor constraints
};

/**
 * Check if the LLM's factor ratings are consistent with the suggested band.
 * If inconsistent, downgrade the band repeatedly until it satisfies the
 * expectations or reaches broad_consumer (which has no constraints).
 *
 * This is intentionally a one-way safety check: it can only DOWNGRADE a band,
 * never upgrade. The LLM or deterministic classifier picks the initial band;
 * this function ensures the factors support it.
 */
export function reconcileBandWithFactors(classification) {
  const bandOrder = ['broad_consumer', 'prosumer', 'b2b_general', 'b2b_technical', 'exec_operator', 'premium_niche'];
  const ratingRank = { low: 0, medium: 1, high: 2 };
  let band = classification.suggestedBand;

  while (true) {
    const expectations = BAND_FACTOR_EXPECTATIONS[band];
    if (!expectations) break; // no constraints — band is valid

    let consistent = true;
    for (const [factor, minRating] of Object.entries(expectations)) {
      const actual = classification[factor] || 'medium';
      if (ratingRank[actual] < ratingRank[minRating]) {
        consistent = false;
        break;
      }
    }
    if (consistent) break;

    const idx = bandOrder.indexOf(band);
    if (idx <= 0) break;
    band = bandOrder[idx - 1];
  }

  return band;
}

// ---------------------------------------------------------------------------
// Structured factor → multiplier adjustments
// ---------------------------------------------------------------------------

// DESIGN DECISIONS:
// - Max raw multiplier from all-high factors is 1.50. This is intentionally
//   conservative. The band/CPM selection does the heavy lifting for pricing
//   differentiation (broad_consumer $15 vs premium_niche $100 = 6.7x range).
//   The multiplier provides fine-tuning within a band, not cross-band jumps.
// - If premium newsletters feel underpriced, increase CPM_BANDS values rather
//   than widening the multiplier range.
const FACTOR_ADJUSTMENTS = {
  audienceQuality:  { low: -0.10, medium: 0, high: 0.15 },
  nicheSpecificity: { low: -0.10, medium: 0, high: 0.20 },
  cadenceHealth:    { low: -0.10, medium: 0, high: 0.05 },
  sponsorFit:       { low: -0.05, medium: 0, high: 0.10 }
};

/**
 * Convert structured LLM factor ratings into a bounded multiplier.
 *
 * Each factor contributes a small additive adjustment. The result is
 * 1.0 + sum(adjustments), clamped to [0.5, 2.0].
 *
 * @param {{ audienceQuality, nicheSpecificity, cadenceHealth, sponsorFit }} factors
 * @returns {number} Multiplier in [0.5, 2.0]
 */
export function factorsToMultiplier(factors) {
  let adjustment = 0;
  for (const [key, ratings] of Object.entries(FACTOR_ADJUSTMENTS)) {
    const rating = factors[key] || 'medium';
    adjustment += ratings[rating] ?? 0;
  }
  return Math.max(0.5, Math.min(2.0, 1.0 + adjustment));
}

// ---------------------------------------------------------------------------
// Baseline price
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic CPM-based baseline price.
 *
 * baseline = (subscribers × openRate / 1000) × cpmRate × engagementMultiplier
 *
 * A per-subscriber floor ensures small but engaged lists get a meaningful baseline.
 *
 * @param {number} subscriberCount
 * @param {number} avgOpenRate - Ratio in [0, 1]
 * @param {number} avgClickRate - Ratio
 * @param {number} cpmRate - Cost per thousand impressions (from band table)
 * @param {number} clickWeight - Weight applied to click rate
 * @returns {number} Baseline price in USD
 */
export function computeBaseline(subscriberCount, avgOpenRate, avgClickRate, cpmRate, clickWeight = 0) {
  const impressions = subscriberCount * (avgOpenRate || 0);
  const engagementMultiplier = 1 + ((avgClickRate || 0) * clickWeight);
  const cpmPrice = (impressions / 1000) * cpmRate * engagementMultiplier;
  // Floor: $0.05 per subscriber. This prevents tiny CPM-based prices for small
  // but engaged lists. The floor dominates for lists under ~5K subscribers at
  // typical CPM rates; above that the CPM calculation takes over naturally.
  // DESIGN DECISION: This makes pricing flat-per-subscriber for small lists and
  // CPM-driven for large lists. If small-list pricing feels disconnected from
  // actual sponsor value, this is the first lever to adjust.
  const floor = subscriberCount * 0.05;
  return Math.max(cpmPrice, floor);
}

/**
 * Clamp a multiplier value to [min, max].
 */
export function clampMultiplier(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

/**
 * Apply week-over-week price smoothing.
 *
 * If any metric change exceeds its significance threshold the full change is
 * allowed. Otherwise the change is capped to capPct of the previous price.
 */
export function applySmoothing(previousPrice, newPrice, capPct, metricChanges, significantThresholds) {
  if (previousPrice == null || previousPrice === 0) {
    return { smoothedPrice: newPrice, smoothingApplied: false };
  }

  const significantChange =
    (metricChanges.subscriberChangePct != null &&
      Math.abs(metricChanges.subscriberChangePct) > significantThresholds.subscriberChangePct) ||
    (metricChanges.openRateChangePts != null &&
      Math.abs(metricChanges.openRateChangePts) > significantThresholds.openRateChangePts);

  if (significantChange) {
    return { smoothedPrice: newPrice, smoothingApplied: false };
  }

  const maxDelta = previousPrice * capPct;
  const delta = newPrice - previousPrice;

  if (Math.abs(delta) <= maxDelta) {
    return { smoothedPrice: newPrice, smoothingApplied: false };
  }

  const smoothedPrice = previousPrice + Math.sign(delta) * maxDelta;
  return { smoothedPrice, smoothingApplied: true };
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * Determine confidence level. Final confidence is the minimum across all factors.
 */
export function determineConfidence({
  publishedIssueCount,
  metricsComplete,
  hasQuestionnaire,
  stabilityCoV,
  isFallback,
  isCadenceIrregular = false,
  isDataStale = false
}) {
  if (isFallback) return 'low';

  const levels = ['low', 'medium', 'high'];
  const rank = (level) => levels.indexOf(level);
  const minLevel = (...lvls) => levels[Math.min(...lvls.map(rank))];

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

  const cadenceFactor = isCadenceIrregular ? 'low' : 'high';
  const recencyFactor = isDataStale ? 'low' : 'high';

  return minLevel(issueFactor, metricsFactor, stabilityFactor, cadenceFactor, recencyFactor);
}

// ---------------------------------------------------------------------------
// LLM response validation
// ---------------------------------------------------------------------------

const VALID_RATINGS = ['low', 'medium', 'high'];

/**
 * Validate the structured LLM classification response.
 *
 * Expected shape:
 * {
 *   audienceQuality: 'low'|'medium'|'high',
 *   nicheSpecificity: 'low'|'medium'|'high',
 *   cadenceHealth: 'low'|'medium'|'high',
 *   sponsorFit: 'low'|'medium'|'high',
 *   suggestedBand: string (one of the valid audience bands),
 *   justification: string
 * }
 */
export function validateLlmResponse(json) {
  const errors = [];

  if (json == null || typeof json !== 'object' || Array.isArray(json)) {
    return { valid: false, errors: ['Response must be a JSON object'] };
  }

  for (const field of ['audienceQuality', 'nicheSpecificity', 'cadenceHealth', 'sponsorFit']) {
    if (!VALID_RATINGS.includes(json[field])) {
      errors.push(`${field} must be one of: low, medium, high`);
    }
  }

  if (typeof json.suggestedBand !== 'string' || !getValidBands().includes(json.suggestedBand)) {
    errors.push(`suggestedBand must be one of: ${getValidBands().join(', ')}`);
  }

  if (typeof json.justification !== 'string') {
    errors.push('justification must be a string');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Metric helpers (unchanged)
// ---------------------------------------------------------------------------

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

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

export function computeMean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function computeStdDev(values) {
  if (values.length < 2) return 0;
  const mean = computeMean(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function computeCoefficientOfVariation(values) {
  if (!values.length) return 0;
  const mean = computeMean(values);
  if (mean === 0) return 0;
  return computeStdDev(values) / mean;
}

export function computeLinearTrend(values) {
  if (!values.length) return { first: 0, last: 0, slopePerIssue: 0 };
  if (values.length === 1) return { first: values[0], last: values[0], slopePerIssue: 0 };
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = computeMean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    numerator += dx * (values[i] - yMean);
    denominator += dx * dx;
  }
  return {
    first: values[0],
    last: values[n - 1],
    slopePerIssue: denominator === 0 ? 0 : numerator / denominator
  };
}

export function computeMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeCadenceStats(publishedAtValues) {
  if (!publishedAtValues || publishedAtValues.length < 2) {
    return { averageDaysBetweenIssues: null, medianDaysBetweenIssues: null, cadenceStdDevDays: null };
  }
  const sorted = [...publishedAtValues]
    .map((v) => new Date(v).getTime())
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sorted.length < 2) {
    return { averageDaysBetweenIssues: null, medianDaysBetweenIssues: null, cadenceStdDevDays: null };
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i] - sorted[i - 1]) / msPerDay);
  return {
    averageDaysBetweenIssues: round(computeMean(gaps), 2),
    medianDaysBetweenIssues: round(computeMedian(gaps), 2),
    cadenceStdDevDays: round(computeStdDev(gaps), 2)
  };
}

export function buildTrendSummary(issueMetrics) {
  const openRates = issueMetrics.map((i) => i.openRate || 0);
  const clickRates = issueMetrics.map((i) => i.clickRate || 0);
  const openTrend = computeLinearTrend(openRates);
  const clickTrend = computeLinearTrend(clickRates);
  return {
    recentTrend: {
      openRate: { first: round(openTrend.first), last: round(openTrend.last), slopePerIssue: round(openTrend.slopePerIssue) },
      clickRate: { first: round(clickTrend.first), last: round(clickTrend.last), slopePerIssue: round(clickTrend.slopePerIssue) }
    },
    volatility: {
      openRateCoV: round(computeCoefficientOfVariation(openRates)),
      clickRateCoV: round(computeCoefficientOfVariation(clickRates))
    }
  };
}

export function computeSubscriberGrowthRate(currentCount, previousCount) {
  if (!previousCount || previousCount === 0) return 0;
  return (currentCount - previousCount) / previousCount;
}

export function computeWeeklyWindow(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();
  let daysSinceWed = (day - 3 + 7) % 7;
  if (daysSinceWed === 0) {
    const timeInDay = hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
    if (timeInDay < 15 * 3600000) daysSinceWed = 7;
  }
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - daysSinceWed);
  start.setUTCHours(15, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function computeRecommendedPrice(baseline, multiplier) {
  return baseline * multiplier;
}

export function computePricingChecksum({ recommendedPrice, subscriberCount, avgOpenRate, avgClickRate, confidence, weekWindow }) {
  const input = [
    recommendedPrice?.toFixed(2), subscriberCount,
    avgOpenRate?.toFixed(6), avgClickRate?.toFixed(6),
    confidence, weekWindow
  ].join('|');
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
