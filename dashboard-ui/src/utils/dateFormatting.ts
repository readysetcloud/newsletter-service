/**
 * Timezone-aware date formatting.
 *
 * Everything the API returns is an instant (RFC3339, almost always UTC). What
 * a person wants to see is that instant as wall-clock time in *their*
 * newsletter's timezone — the same zone the backend anchors date-only sends
 * to. These helpers take that zone explicitly; components normally reach them
 * through `useTenantDateFormat()`, which supplies the tenant's configured zone
 * from settings.
 *
 * Every formatter is defensive about bad input: an empty, missing, or
 * unparseable value formats as an empty string rather than "Invalid Date", and
 * an unusable timezone falls back to the viewer's browser zone instead of
 * throwing.
 */

/** Rendered in place of a date that can't be parsed. */
const EMPTY = '';

/** The `YYYY-MM-DDTHH:mm` shape an `<input type="datetime-local">` produces. */
const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `Intl` throws on an unknown timezone, and a bad stored value shouldn't take
 * a page down. Falling back to `undefined` lets `Intl` use the browser zone.
 */
function safeFormatter(
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
  locale?: string
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat(locale, options);
  }
}

/**
 * Formats an instant as wall-clock time in `timeZone`. The escape hatch for
 * anything the named helpers below don't cover.
 */
export function formatInTimeZone(
  value: DateInput,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
  locale?: string
): string {
  const date = toDate(value);
  if (!date) return EMPTY;

  return safeFormatter(timeZone, options, locale).format(date);
}

/** `Aug 1, 2026` */
export function formatDateInTimeZone(value: DateInput, timeZone?: string, locale?: string): string {
  return formatInTimeZone(
    value,
    timeZone,
    { year: 'numeric', month: 'short', day: 'numeric' },
    locale
  );
}

/** `August 1, 2026` */
export function formatLongDateInTimeZone(
  value: DateInput,
  timeZone?: string,
  locale?: string
): string {
  return formatInTimeZone(
    value,
    timeZone,
    { year: 'numeric', month: 'long', day: 'numeric' },
    locale
  );
}

/** `9:00 AM` */
export function formatTimeInTimeZone(value: DateInput, timeZone?: string, locale?: string): string {
  return formatInTimeZone(value, timeZone, { hour: 'numeric', minute: '2-digit' }, locale);
}

/**
 * `Aug 1, 2026, 9:00 AM CDT` — the zone abbreviation matters here because the
 * time shown is deliberately *not* the viewer's own clock.
 */
export function formatDateTimeInTimeZone(
  value: DateInput,
  timeZone?: string,
  locale?: string
): string {
  return formatInTimeZone(
    value,
    timeZone,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    },
    locale
  );
}

/**
 * The short zone name in effect at `value` (`CDT`, `GMT+9`, …). Useful as a
 * suffix on inputs whose value is a wall-clock time in the tenant's zone.
 */
export function getTimeZoneAbbreviation(timeZone?: string, value: DateInput = new Date()): string {
  const date = toDate(value) ?? new Date();
  const parts = safeFormatter(timeZone, {
    hour: 'numeric',
    timeZoneName: 'short',
  }).formatToParts(date);

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? EMPTY;
}

/**
 * The offset of `timeZone` at a given instant, in milliseconds east of UTC.
 * Derived by reading the zone's own wall clock at that instant and comparing
 * it to the instant itself — the only way to get a historically correct,
 * DST-aware offset out of `Intl`.
 */
function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = safeFormatter(timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const wallClockAsUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second')
  );

  return wallClockAsUtc - instantMs;
}

/**
 * Converts an instant into the `YYYY-MM-DDTHH:mm` string an
 * `<input type="datetime-local">` expects, expressed in `timeZone` rather than
 * the browser's zone.
 */
export function toDatetimeLocalInTimeZone(value: DateInput, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return EMPTY;

  if (!timeZone) {
    // Browser-zone equivalent: shift by the local offset, then slice the ISO.
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return shifted.toISOString().slice(0, 16);
  }

  const shifted = new Date(date.getTime() + timeZoneOffsetMs(date.getTime(), timeZone));
  return shifted.toISOString().slice(0, 16);
}

/**
 * The inverse: reads a `YYYY-MM-DDTHH:mm` wall-clock string as a time in
 * `timeZone` and returns the corresponding instant as an ISO string.
 *
 * The offset is applied twice on purpose. The first pass uses the offset at
 * the wall-clock time treated as UTC, which is wrong by up to an hour when the
 * value sits near a DST boundary; re-reading the offset at that first estimate
 * lands on the correct instant.
 *
 * A wall-clock time inside a spring-forward gap never happens, and no offset
 * makes it happen — the two-pass result lands *before* the requested time,
 * which would send an issue an hour early. Those are resolved forward to the
 * first minute that does exist, matching `resolve_date_only` in `settings.rs`
 * so the dashboard and the API agree on what a gap time means.
 */
export function fromDatetimeLocalInTimeZone(value: string, timeZone?: string): string {
  // `Date.parse` is lenient enough to find a date in strings that are nothing
  // of the sort, so the shape is checked before anything is parsed.
  if (!DATETIME_LOCAL_PATTERN.test(value)) return EMPTY;

  if (!timeZone) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? EMPTY : date.toISOString();
  }

  const wallClock = value.slice(0, 16);
  const asUtc = Date.parse(`${wallClock}:00Z`);
  if (Number.isNaN(asUtc)) return EMPTY;

  const instant = resolveWallClock(asUtc, timeZone);
  if (instant === null) return EMPTY;

  return new Date(instant).toISOString();
}

/**
 * Turns a wall-clock time (expressed as though it were UTC) into the instant it
 * names in `timeZone`, or null if the input isn't a usable time.
 */
function resolveWallClock(asUtc: number, timeZone: string): number | null {
  const firstPass = asUtc - timeZoneOffsetMs(asUtc, timeZone);
  const instant = asUtc - timeZoneOffsetMs(firstPass, timeZone);

  // Round-trip check: if reading the instant back in the zone doesn't give the
  // wall clock we asked for, that wall clock doesn't exist on that day.
  if (wallClockOf(instant, timeZone) === asUtc) {
    return instant;
  }

  // Walk forward to the first wall-clock minute that does exist. DST gaps are
  // at most a couple of hours, so the bound is generous rather than tight.
  for (let minutes = 1; minutes <= GAP_SEARCH_LIMIT_MINUTES; minutes += 1) {
    const candidate = asUtc + minutes * 60_000;
    const resolved = candidate - timeZoneOffsetMs(candidate - timeZoneOffsetMs(candidate, timeZone), timeZone);
    if (wallClockOf(resolved, timeZone) === candidate) {
      return resolved;
    }
  }

  // No valid time found (should be unreachable for real zones) — the two-pass
  // estimate is still a real instant, so prefer it over failing outright.
  return instant;
}

/** The zone's wall clock at `instant`, as though that wall clock were UTC. */
function wallClockOf(instant: number, timeZone: string): number {
  return instant + timeZoneOffsetMs(instant, timeZone);
}

/** Longest spring-forward gap we'll search past. Real gaps are 30–120 minutes. */
const GAP_SEARCH_LIMIT_MINUTES = 180;

/**
 * Combines a `YYYY-MM-DD` date and an `HH:MM` time into the instant they name
 * in `timeZone` — the browser-side mirror of how the API resolves a date-only
 * `scheduledAt` against the tenant's default send time.
 */
export function combineDateAndTimeInTimeZone(
  date: string,
  time: string,
  timeZone?: string
): string {
  if (!date || !time) return EMPTY;
  return fromDatetimeLocalInTimeZone(`${date}T${time}`, timeZone);
}

/** The browser's own timezone, used to seed a tenant that hasn't picked one. */
export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
