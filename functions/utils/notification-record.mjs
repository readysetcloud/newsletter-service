/**
 * How an in-app notification is stored, shared by the writer and read by the
 * API.
 *
 * Notifications live under one partition per tenant and are read newest-first
 * straight off the base table — no index, because there is only ever one way to
 * ask for them. Read state is a single `readAt` on the row rather than a marker
 * per person: a tenant's users share one inbox, which is the whole reason it
 * can be this simple.
 *
 * The Rust API mirrors the key shapes in
 * `functions/src/api/controllers/notifications.rs`. Change one and change the
 * other; `__tests__/notification-record.test.mjs` pins the shapes both sides
 * rely on.
 */

/** Every row for a tenant's inbox, notifications and nothing else. */
export const notificationPartitionKey = (tenantId) => `${tenantId}#notification`;

/** Prefix every listable row carries, so the query can exclude anything else. */
export const NOTIFICATION_SK_PREFIX = 'notification#';

/**
 * How long a notification sticks around. Long enough that someone back from
 * leave still sees what happened, short enough that the partition does not grow
 * without bound.
 */
export const NOTIFICATION_TTL_DAYS = 90;

/** What a notification is about. The dashboard picks its icon from this. */
export const NOTIFICATION_TYPES = {
  REPORT_READY: 'report.ready',
  REPORT_EMPTY: 'report.empty',
  REPORT_FAILED: 'report.failed',
  ISSUE_PUBLISHED: 'issue.published',
  ISSUE_FAILED: 'issue.failed',
  SENDER_VERIFIED: 'sender.verified',
  SENDER_FAILED: 'sender.failed',
  BILLING_PAYMENT_SUCCEEDED: 'billing.payment_succeeded',
  BILLING_PAYMENT_FAILED: 'billing.payment_failed'
};

/** How loudly to render it. */
export const NOTIFICATION_SEVERITY = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

/**
 * Characters a dedupe key may keep. Everything else becomes '-', because the
 * key ends up in a sort key and in a URL path segment, and an issue subject or
 * a Stripe id should not be able to break either.
 */
const UNSAFE_KEY_CHARS = /[^A-Za-z0-9_.:-]+/g;

const sanitizeKeyPart = (value) => String(value ?? '').replace(UNSAFE_KEY_CHARS, '-');

/**
 * The id of a notification, which is also what makes writing one idempotent.
 *
 * Two parts: when the event happened, then what it was about. The timestamp
 * leads so ids sort chronologically — epoch milliseconds are 13 digits until
 * the year 2286, so plain string ordering is date ordering without padding
 * games — and the dedupe key makes the whole thing deterministic for a given
 * event.
 *
 * That determinism is the point. EventBridge delivers at least once and retries
 * a failed target, so the same report finishing can arrive here more than once.
 * A conditional write on a key derived from the event turns the second delivery
 * into a no-op instead of a second notification.
 *
 * `occurredAt` must therefore be the event's own timestamp, not `Date.now()` —
 * EventBridge keeps `time` stable across retries, and a fresh clock reading
 * would make every retry a new notification.
 */
export const notificationId = (occurredAt, dedupeKey) => {
  const millis = new Date(occurredAt).getTime();
  const stamp = Number.isFinite(millis) ? millis : 0;

  return `${stamp}-${sanitizeKeyPart(dedupeKey)}`;
};

/** The sort key for an id. */
export const notificationSortKey = (id) => `${NOTIFICATION_SK_PREFIX}${id}`;

/** The id for a sort key. */
export const notificationIdFromSortKey = (sortKey) =>
  (sortKey ?? '').startsWith(NOTIFICATION_SK_PREFIX)
    ? sortKey.slice(NOTIFICATION_SK_PREFIX.length)
    : sortKey;

/** Epoch seconds at which a notification created now should expire. */
export const notificationTtl = (createdAt = new Date()) =>
  Math.floor(new Date(createdAt).getTime() / 1000) + NOTIFICATION_TTL_DAYS * 24 * 60 * 60;

/**
 * The complete item to write, ready for `marshall`.
 *
 * `readAt` is deliberately absent rather than null: the unread query filters on
 * `attribute_not_exists(readAt)`, which an explicit null would defeat.
 */
export const buildNotificationItem = ({
  tenantId,
  occurredAt,
  dedupeKey,
  type,
  severity = NOTIFICATION_SEVERITY.INFO,
  title,
  message,
  link = null
}) => {
  const id = notificationId(occurredAt, dedupeKey);
  const createdAt = new Date(occurredAt).toISOString();

  return {
    pk: notificationPartitionKey(tenantId),
    sk: notificationSortKey(id),
    id,
    type,
    severity,
    title,
    message,
    ...(link ? { link } : {}),
    createdAt,
    ttl: notificationTtl(createdAt)
  };
};
