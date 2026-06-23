/**
 * Builds the cross-issue A/B test history record (A/B Testing R2).
 *
 * Pure module: given a finalized abTest config and the per-variant counters, it
 * produces a self-contained, denormalized DynamoDB item so the read API and the
 * LLM-suggestion path can consume history without re-reading issue/stats records.
 *
 * Record key: pk = `${tenantId}#abhistory`, sk = `test#${issueNumber}` — one row
 * per test, queryable per tenant via the partition. Writing with the same key is
 * an idempotent upsert (redeliveries update, never duplicate).
 */

const round = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
};

const rate = (successes, deliveries) =>
  deliveries > 0 ? round((Number(successes || 0) / Number(deliveries)) * 100) : 0;

/**
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {number|string} params.issueNumber
 * @param {Object} params.abTest - The finalized abTest config (with evaluation, winnerVariantId, status).
 * @param {Object} params.counters - Per-variant counters keyed by variantId: { a: {opens,clicks,deliveries}, b: {...} }.
 * @returns {Object} The history record item (plain object, ready to marshall).
 */
export const buildAbHistoryRecord = ({ tenantId, issueNumber, abTest, counters = {} }) => {
  const winMetric = abTest.winMetric === 'clickRate' ? 'clickRate' : 'openRate';

  const variants = (abTest.variants || []).map((variant) => {
    const counter = counters[variant.variantId] || {};
    const opens = Number(counter.opens || 0);
    const clicks = Number(counter.clicks || 0);
    const deliveries = Number(counter.deliveries || 0);
    return {
      variantId: variant.variantId,
      ...(variant.subject !== undefined && { subject: variant.subject }),
      ...(variant.sendAt !== undefined && { sendAt: variant.sendAt }),
      opens,
      clicks,
      deliveries,
      openRate: rate(opens, deliveries),
      clickRate: rate(clicks, deliveries)
    };
  });

  const byId = Object.fromEntries(variants.map((v) => [v.variantId, v]));
  const control = byId.a;
  const winner = abTest.winnerVariantId ? byId[abTest.winnerVariantId] : null;
  const lift = winner && control ? round(winner[winMetric] - control[winMetric]) : null;

  return {
    pk: `${tenantId}#abhistory`,
    sk: `test#${issueNumber}`,
    recordType: 'abHistory',
    tenantId,
    issueNumber: Number(issueNumber),
    dimension: abTest.dimension,
    winMetric,
    status: abTest.status ?? null,
    winnerVariantId: abTest.winnerVariantId ?? null,
    significant: Boolean(abTest.evaluation?.significant),
    confidence: abTest.evaluation?.confidence ?? null,
    lift,
    variants,
    decidedAt: abTest.evaluation?.decidedAt || new Date().toISOString()
  };
};
