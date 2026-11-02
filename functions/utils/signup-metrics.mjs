/**
 * Signup velocity metrics, as CloudWatch Embedded Metric Format log lines.
 *
 * These exist because reputation was the only thing watching signup quality,
 * and reputation lags: the September 2026 complaint-rate climb from 0.38% to
 * 0.53% took five weeks to become visible, by which point the list already
 * held the addresses that caused it. Signup rate is the leading indicator —
 * whatever a flood is made of, there is a lot of it and it arrives quickly.
 *
 * Why EMF rather than cloudwatch-metrics.mjs, which the rest of the service
 * uses: the signup endpoint is public, unauthenticated and precisely what a
 * bot flood points at. A PutMetricData call per request would add an AWS round
 * trip to a user-facing response and multiply by exactly the traffic being
 * measured — a thousand bot signups becomes a thousand extra API calls against
 * an account-wide rate limit, at the moment the system is already loaded. An
 * EMF document is written to the log stream Lambda ships anyway, so it costs
 * no latency, no API call and no IAM permission of its own.
 */

const NAMESPACE = 'Newsletter/Signups';

/** A signup that created a subscriber. */
export const SIGNUPS_ACCEPTED = 'SignupsAccepted';

/** A signup refused by bot protection or the rate limiter. */
export const SIGNUPS_BLOCKED = 'SignupsBlocked';

/**
 * Record one signup outcome.
 *
 * Two dimension sets are emitted: by tenant, and aggregate. The aggregate one
 * is what an alarm watches — a CloudWatch alarm has to name every dimension
 * value it watches, and the template cannot know a tenant's id — while the
 * per-tenant series is what answers "which list is this happening to".
 *
 * Never throws. A metric that cannot be written must not fail a signup.
 *
 * @param {string} metricName - SIGNUPS_ACCEPTED or SIGNUPS_BLOCKED
 * @param {string} tenantId - Tenant the signup was for
 * @param {number} [value=1] - Count to record
 */
export function emitSignupMetric(metricName, tenantId, value = 1) {
  try {
    // A bare console.log on purpose. EMF requires the metric document at the
    // root of the log line, and structured-logger.mjs nests whatever it is
    // given inside its own envelope, where CloudWatch would never find it.
    console.log(JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [{
          Namespace: NAMESPACE,
          Dimensions: [['TenantId'], []],
          Metrics: [{ Name: metricName, Unit: 'Count' }]
        }]
      },
      TenantId: tenantId || 'unknown',
      [metricName]: value
    }));
  } catch (err) {
    console.warn('Failed to emit signup metric', { metricName, error: err.message });
  }
}
