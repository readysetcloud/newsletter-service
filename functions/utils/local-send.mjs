/**
 * Pure time/grouping helpers for the local-send feature.
 *
 * Local send delivers an issue at the same wall-clock time in each
 * subscriber's confirmed timezone: the issue's send instant is interpreted as
 * a wall-clock time in the issue's default timezone, and every other timezone
 * group is scheduled for the UTC instant when its own wall clock reads that
 * same time.
 *
 * All timezone math uses the built-in Intl API (IANA zones, DST-correct) so no
 * date library is needed.
 */

/** Group key for subscribers without a confirmed timezone. */
export const DEFAULT_GROUP = '__default__';

/** Group key for the final catch-all send that backstops missed subscribers. */
export const CATCH_ALL_GROUP = '__catch_all__';

/**
 * Whether a string is a usable IANA timezone name on this runtime.
 * @param {string} timeZone
 * @returns {boolean}
 */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the wall-clock fields a UTC instant displays in a timezone.
 * @param {Date|number} instant
 * @param {string} timeZone - IANA timezone name
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number}}
 */
export function getWallClockInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(instant));

  const get = (type) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second')
  };
}

/**
 * Milliseconds the zone's wall clock is ahead of UTC at the given instant.
 * @param {number} instantMs
 * @param {string} timeZone
 * @returns {number}
 */
function zoneOffsetMs(instantMs, timeZone) {
  const wall = getWallClockInZone(instantMs, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Drop sub-second precision from the instant: the wall clock has none.
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Convert a wall-clock time in a timezone to the UTC instant at which that
 * zone's clock shows it. DST-correct: near transitions the offset is
 * re-evaluated at the candidate instant, so a nonexistent local time (spring
 * forward) resolves to the shifted instant and an ambiguous one (fall back)
 * resolves deterministically.
 *
 * @param {{year: number, month: number, day: number, hour: number, minute: number, second?: number}} wallClock
 * @param {string} timeZone - IANA timezone name
 * @returns {Date}
 */
export function zonedWallClockToUtc(wallClock, timeZone) {
  const { year, month, day, hour, minute, second = 0 } = wallClock;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  const firstOffset = zoneOffsetMs(asUtc, timeZone);
  let candidate = asUtc - firstOffset;

  const secondOffset = zoneOffsetMs(candidate, timeZone);
  if (secondOffset !== firstOffset) {
    candidate = asUtc - secondOffset;
  }

  return new Date(candidate);
}

/**
 * Group subscribers by confirmed timezone. Subscribers without a confirmed
 * (and valid) timezone land in the DEFAULT_GROUP.
 *
 * @param {Array<{email: string, timeZone?: string}>} subscribers
 * @returns {Map<string, Array<object>>} timezone (or DEFAULT_GROUP) -> subscribers
 */
export function groupSubscribersByTimeZone(subscribers) {
  const groups = new Map();
  for (const subscriber of subscribers) {
    const zone = subscriber.timeZone && isValidTimeZone(subscriber.timeZone)
      ? subscriber.timeZone
      : DEFAULT_GROUP;
    if (!groups.has(zone)) {
      groups.set(zone, []);
    }
    groups.get(zone).push(subscriber);
  }
  return groups;
}

/**
 * Filter a subscriber list down to the members of a local-send group.
 * The catch-all group takes everyone (the send pipeline's lastIssueSent
 * idempotency filter turns already-sent subscribers into no-ops).
 *
 * @param {Array<{email: string, timeZone?: string}>} subscribers
 * @param {string} groupKey - Timezone name, DEFAULT_GROUP, or CATCH_ALL_GROUP
 * @returns {Array<object>}
 */
export function filterSubscribersForGroup(subscribers, groupKey) {
  if (groupKey === CATCH_ALL_GROUP) {
    return subscribers;
  }
  if (groupKey === DEFAULT_GROUP) {
    return subscribers.filter((s) => !(s.timeZone && isValidTimeZone(s.timeZone)));
  }
  return subscribers.filter((s) => s.timeZone === groupKey);
}

/**
 * Minimum recorded opens before a subscriber's histogram is trusted for
 * peak-hour sends.
 */
export const PEAK_HOUR_MIN_SAMPLES = 5;

/**
 * Compute a subscriber's peak open hour (UTC, 0-23) from their open-hour
 * histogram, or null when the data is insufficient (fewer than minSamples
 * recorded opens, or an empty/absent histogram).
 *
 * The histogram is stored by activity-timeline.mjs recordOpenHour as a map of
 * UTC-hour string keys ("0".."23") to counts, plus an openHourTotal counter.
 * DynamoDB round-trips may surface keys and counts as strings, so both are
 * coerced. The highest count wins; ties break to the lowest hour so the result
 * is deterministic.
 *
 * @param {Object<string, number|string>|undefined} openHours - Hour -> count map
 * @param {number|string|undefined} openHourTotal - Total recorded opens
 * @param {number} [minSamples] - Minimum opens before the histogram is trusted
 * @returns {number|null} UTC hour 0-23, or null when data is insufficient
 */
export function computePeakHour(openHours, openHourTotal, minSamples = PEAK_HOUR_MIN_SAMPLES) {
  const total = Number(openHourTotal);
  if (!openHours || typeof openHours !== 'object' || !Number.isFinite(total) || total < minSamples) {
    return null;
  }

  let peakHour = null;
  let peakCount = 0;
  for (const [key, value] of Object.entries(openHours)) {
    const hour = Number(key);
    const count = Number(value);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    if (count > peakCount || (count === peakCount && peakHour !== null && hour < peakHour)) {
      peakHour = hour;
      peakCount = count;
    }
  }
  return peakHour;
}

/**
 * The first instant >= base whose UTC hour equals `hour`, preserving the
 * base's minute (so a 9:30-scheduled issue lands at each subscriber's peak
 * hour on the half hour). Candidate = the base's UTC date at
 * (hour, base minute); when that is before the base it rolls forward 24h.
 * Seconds/millis are zeroed, so a base mid-minute at the target hour:minute
 * rolls to the next day rather than firing in the past.
 *
 * @param {Date|number} baseInstant - The issue's send instant (UTC)
 * @param {number} hour - Target UTC hour 0-23
 * @returns {Date}
 */
export function nextOccurrenceOfUtcHour(baseInstant, hour) {
  const base = new Date(baseInstant);
  let candidateMs = Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate(),
    hour,
    base.getUTCMinutes()
  );
  if (candidateMs < base.getTime()) {
    candidateMs += 24 * 60 * 60 * 1000;
  }
  return new Date(candidateMs);
}

/**
 * Group subscribers by their computed peak open hour. Subscribers without
 * enough histogram data land in the DEFAULT_GROUP.
 *
 * @param {Array<{email: string, openHours?: Object, openHourTotal?: number}>} subscribers
 * @param {number} [minSamples]
 * @returns {Map<number|string, Array<object>>} UTC hour (number) or DEFAULT_GROUP -> subscribers
 */
export function groupSubscribersByPeakHour(subscribers, minSamples = PEAK_HOUR_MIN_SAMPLES) {
  const groups = new Map();
  for (const subscriber of subscribers) {
    const peakHour = computePeakHour(subscriber.openHours, subscriber.openHourTotal, minSamples);
    const key = peakHour === null ? DEFAULT_GROUP : peakHour;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(subscriber);
  }
  return groups;
}

/**
 * Filter a subscriber list down to the members of a peak-hour group.
 * A null group key is the insufficient-data default group.
 *
 * @param {Array<{email: string, openHours?: Object, openHourTotal?: number}>} subscribers
 * @param {number|null} peakHour - UTC hour 0-23, or null for the default group
 * @param {number} [minSamples]
 * @returns {Array<object>}
 */
export function filterSubscribersForPeakHourGroup(subscribers, peakHour, minSamples = PEAK_HOUR_MIN_SAMPLES) {
  return subscribers.filter(
    (s) => computePeakHour(s.openHours, s.openHourTotal, minSamples) === peakHour
  );
}

/**
 * Compute the UTC send instant for each timezone group.
 *
 * The base instant (the issue's scheduled/actual send time) is interpreted as
 * a wall-clock time in the default timezone; each group fires when its own
 * wall clock reads that time. The DEFAULT_GROUP fires exactly at the base
 * instant (no round-trip through wall-clock conversion, so no drift).
 *
 * @param {Date|number} baseInstant - The issue's send instant (UTC)
 * @param {string} defaultTimeZone - Zone whose wall clock defines the target time
 * @param {Iterable<string>} timeZones - Group keys from groupSubscribersByTimeZone
 * @returns {Map<string, Date>} group key -> UTC send time
 */
export function computeGroupSendTimes(baseInstant, defaultTimeZone, timeZones) {
  const base = new Date(baseInstant);
  const targetWallClock = getWallClockInZone(base, defaultTimeZone);

  const sendTimes = new Map();
  for (const zone of timeZones) {
    if (zone === DEFAULT_GROUP || zone === defaultTimeZone) {
      sendTimes.set(zone, base);
    } else {
      sendTimes.set(zone, zonedWallClockToUtc(targetWallClock, zone));
    }
  }
  return sendTimes;
}
