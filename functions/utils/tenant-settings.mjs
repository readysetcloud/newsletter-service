/**
 * Reads the tenant-wide defaults written by the admin API's `/settings`
 * endpoint (`functions/src/api/controllers/settings.rs`) and applies them to
 * the publish pipeline.
 *
 * These are the values the platform falls back to when a request doesn't spell
 * something out: which timezone a bare date is read against, what time of day
 * such a send lands on, how a subject line is built, and where an issue lives
 * on the tenant's site.
 *
 * Every read here is fail-open. A settings lookup that errors — or a tenant id
 * that was never threaded through — degrades to the documented defaults rather
 * than failing a publish that was otherwise ready to go.
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

/** Keep in step with `DEFAULT_TIMEZONE` in `settings.rs`. */
export const DEFAULT_TIMEZONE = 'UTC';

/** Keep in step with `DEFAULT_SEND_TIME` in `settings.rs`. */
export const DEFAULT_SEND_TIME = '09:00';

/** A bare calendar date, with no time of day attached. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SEND_TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * The effective settings when the tenant has saved nothing (or the read
 * failed). `subjectTemplate` and `issueUrlPattern` have no system default:
 * absent means "the caller decides", not "use this".
 */
export const DEFAULT_SETTINGS = Object.freeze({
  timezone: DEFAULT_TIMEZONE,
  defaultSendTime: DEFAULT_SEND_TIME,
  subjectTemplate: null,
  issueUrlPattern: null
});

/**
 * Loads a tenant's effective settings. Returns {@link DEFAULT_SETTINGS} for an
 * unknown tenant, a missing record, or any failure — publishing must not break
 * because a preferences lookup did.
 *
 * @param {string} [tenantId]
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export const getTenantSettings = async (tenantId) => {
  if (!tenantId) {
    return DEFAULT_SETTINGS;
  }

  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: tenantId, sk: 'settings' })
    }));

    if (!result.Item) {
      return DEFAULT_SETTINGS;
    }

    const item = unmarshall(result.Item);
    return {
      timezone: nonEmpty(item.timezone) ?? DEFAULT_SETTINGS.timezone,
      defaultSendTime: nonEmpty(item.defaultSendTime) ?? DEFAULT_SETTINGS.defaultSendTime,
      subjectTemplate: nonEmpty(item.subjectTemplate) ?? null,
      issueUrlPattern: nonEmpty(item.issueUrlPattern) ?? null
    };
  } catch (err) {
    console.error('Failed to load tenant settings, using defaults', { tenantId, error: err.message });
    return DEFAULT_SETTINGS;
  }
};

const nonEmpty = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/**
 * True when a value names a day but no time of day, and therefore needs the
 * tenant's default send time to become an instant. Accepts the `YYYY-MM-DD`
 * string form and a `Date` that is exactly UTC midnight — which is what a YAML
 * parser produces from a bare frontmatter `date:`.
 */
export const isDateOnly = (value) => {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime()) && value.toISOString().endsWith('T00:00:00.000Z');
  }
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim());
};

/** The `YYYY-MM-DD` day a date-only value refers to. */
const dayOf = (value) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim().slice(0, 10);
};

/**
 * The offset of `timeZone` at a given instant, in milliseconds east of UTC.
 * Derived by reading the zone's own wall clock at that instant and comparing
 * it back — the only DST-correct way to get an offset out of `Intl`.
 */
const timeZoneOffsetMs = (instantMs, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(instantMs));

  const read = (type) => Number(parts.find((part) => part.type === type)?.value ?? '0');

  const wallClockAsUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second')
  );

  return wallClockAsUtc - instantMs;
};

/**
 * Reads `YYYY-MM-DDTHH:mm` as a wall-clock time in `timeZone` and returns the
 * instant it names.
 *
 * The offset is applied twice on purpose: the first pass uses the offset at
 * the wall-clock time treated as UTC, which is wrong by up to an hour near a
 * DST boundary, and re-reading the offset at that estimate lands on the right
 * instant. Mirrors `resolve_date_only` in `settings.rs` and
 * `fromDatetimeLocalInTimeZone` in the dashboard.
 */
const wallClockToInstant = (wallClock, timeZone) => {
  const asUtc = Date.parse(`${wallClock}:00Z`);
  if (Number.isNaN(asUtc)) return null;

  let offset;
  try {
    offset = timeZoneOffsetMs(asUtc, timeZone);
    const firstPass = asUtc - offset;
    offset = timeZoneOffsetMs(firstPass, timeZone);
  } catch (err) {
    console.error('Unknown timezone, falling back to UTC', { timeZone, error: err.message });
    return new Date(asUtc);
  }

  return new Date(asUtc - offset);
};

/**
 * Resolves a send date into the instant it should actually go out at.
 *
 * A date-only value is anchored to the tenant's default send time, read as
 * wall-clock time in the tenant's timezone. A value that already carries a
 * time of day is respected as given — settings fill in what the caller left
 * out, they don't override what the caller said.
 *
 * @param {string|Date} value
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {Date|null} null when the value isn't a usable date
 */
export const resolveSendInstant = (value, settings = DEFAULT_SETTINGS) => {
  if (value === null || value === undefined || value === '') return null;

  if (!isDateOnly(value)) {
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const day = dayOf(value);
  const sendTime = SEND_TIME_PATTERN.test(settings.defaultSendTime ?? '')
    ? padSendTime(settings.defaultSendTime)
    : DEFAULT_SEND_TIME;

  const resolved = wallClockToInstant(`${day}T${sendTime}`, settings.timezone || DEFAULT_TIMEZONE);
  if (resolved && !Number.isNaN(resolved.getTime())) {
    return resolved;
  }

  // A wall-clock time that doesn't exist (a spring-forward gap) or an
  // unparseable day: fall back to the day at the send time in UTC rather than
  // dropping the schedule entirely.
  const fallback = new Date(`${day}T${sendTime}:00Z`);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

/** `9:05` → `09:05`. */
const padSendTime = (value) => {
  const match = SEND_TIME_PATTERN.exec(value.trim());
  if (!match) return value;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
};

/**
 * Substitutes `{{token}}` placeholders. Deliberately not Handlebars: these
 * templates produce an email subject and a URL, where the only thing wanted is
 * literal substitution, and where helpers/partials would be a needless way to
 * fail at send time.
 *
 * Unknown tokens are left untouched so a typo is visible rather than silently
 * blanking part of the subject. Whitespace inside the braces is tolerated.
 */
export const renderTokens = (template, tokens) => {
  if (typeof template !== 'string') return '';

  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (match, name) => {
    const value = tokens[name];
    return value === undefined || value === null ? match : String(value);
  });
};

/**
 * Builds an issue's email subject.
 *
 * Precedence follows the whole point of these settings — anything the request
 * supplied wins, and the tenant's template only fills a gap:
 *   1. the subject the caller sent
 *   2. the tenant's `subjectTemplate`
 *   3. the issue title, or a generic fallback
 */
export const buildSubject = (settings, { callerSubject, title, number, date } = {}) => {
  const supplied = nonEmpty(callerSubject);
  if (supplied) return supplied;

  const template = nonEmpty(settings?.subjectTemplate);
  if (template) {
    const rendered = nonEmpty(renderTokens(template, { title, number, date }));
    if (rendered) return rendered;
  }

  return nonEmpty(title) ?? `Newsletter Issue #${number}`;
};

/**
 * Builds the public URL for an issue from the tenant's `issueUrlPattern`.
 * Returns null when no pattern is configured — callers omit the field rather
 * than emitting a link to somebody else's site.
 */
export const buildIssueUrl = (settings, { number } = {}) => {
  const pattern = nonEmpty(settings?.issueUrlPattern);
  if (!pattern) return null;

  return nonEmpty(renderTokens(pattern, { number }));
};
