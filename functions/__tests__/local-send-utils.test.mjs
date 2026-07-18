import {
  isValidTimeZone,
  getWallClockInZone,
  zonedWallClockToUtc,
  groupSubscribersByTimeZone,
  computeGroupSendTimes,
  filterSubscribersForGroup,
  DEFAULT_GROUP,
  CATCH_ALL_GROUP
} from '../utils/local-send.mjs';

describe('isValidTimeZone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe('getWallClockInZone', () => {
  it('reads the wall clock for a UTC instant in a zone', () => {
    // 2026-01-15T14:00:00Z is 09:00 in New York (EST, UTC-5)
    const wall = getWallClockInZone(new Date('2026-01-15T14:00:00Z'), 'America/New_York');
    expect(wall).toEqual({ year: 2026, month: 1, day: 15, hour: 9, minute: 0, second: 0 });
  });

  it('honors DST offsets', () => {
    // 2026-07-15T13:00:00Z is 09:00 in New York (EDT, UTC-4)
    const wall = getWallClockInZone(new Date('2026-07-15T13:00:00Z'), 'America/New_York');
    expect(wall.hour).toBe(9);
  });

  it('handles half-hour offset zones', () => {
    // 2026-01-15T03:30:00Z is 09:00 in Kolkata (UTC+5:30)
    const wall = getWallClockInZone(new Date('2026-01-15T03:30:00Z'), 'Asia/Kolkata');
    expect(wall).toEqual({ year: 2026, month: 1, day: 15, hour: 9, minute: 0, second: 0 });
  });
});

describe('zonedWallClockToUtc', () => {
  const wall9am = (month, day) => ({ year: 2026, month, day, hour: 9, minute: 0 });

  it('converts winter (standard-time) wall clocks', () => {
    // 09:00 EST = 14:00 UTC
    const utc = zonedWallClockToUtc(wall9am(1, 15), 'America/New_York');
    expect(utc.toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('converts summer (DST) wall clocks', () => {
    // 09:00 EDT = 13:00 UTC
    const utc = zonedWallClockToUtc(wall9am(7, 15), 'America/New_York');
    expect(utc.toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });

  it('round-trips: the zone wall clock at the returned instant matches the input', () => {
    const zones = ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Australia/Sydney', 'UTC', 'Pacific/Auckland'];
    for (const zone of zones) {
      for (const [month, day] of [[1, 15], [4, 10], [7, 15], [10, 20], [12, 31]]) {
        const utc = zonedWallClockToUtc(wall9am(month, day), zone);
        const wall = getWallClockInZone(utc, zone);
        expect({ zone, month, day, hour: wall.hour, minute: wall.minute })
          .toEqual({ zone, month, day, hour: 9, minute: 0 });
      }
    }
  });

  it('converts UTC wall clocks identically', () => {
    const utc = zonedWallClockToUtc({ year: 2026, month: 3, day: 1, hour: 12, minute: 30 }, 'UTC');
    expect(utc.toISOString()).toBe('2026-03-01T12:30:00.000Z');
  });

  it('resolves a nonexistent spring-forward time to a real instant', () => {
    // US DST 2026 starts Mar 8: 02:30 does not exist in America/New_York.
    const utc = zonedWallClockToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
    // Must be a valid instant within an hour of the gap, not NaN.
    expect(Number.isNaN(utc.getTime())).toBe(false);
    const wall = getWallClockInZone(utc, 'America/New_York');
    expect(wall.day).toBe(8);
    expect([1, 3]).toContain(wall.hour);
  });

  it('resolves an ambiguous fall-back time deterministically', () => {
    // US DST 2026 ends Nov 1: 01:30 occurs twice in America/New_York.
    const utc = zonedWallClockToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York');
    const wall = getWallClockInZone(utc, 'America/New_York');
    expect(wall.hour).toBe(1);
    expect(wall.minute).toBe(30);
  });
});

describe('groupSubscribersByTimeZone', () => {
  it('groups by confirmed timezone with a default bucket', () => {
    const subscribers = [
      { email: 'a@x.com', timeZone: 'America/New_York' },
      { email: 'b@x.com', timeZone: 'America/New_York' },
      { email: 'c@x.com', timeZone: 'Europe/London' },
      { email: 'd@x.com' },
      { email: 'e@x.com', timeZone: null }
    ];

    const groups = groupSubscribersByTimeZone(subscribers);

    expect([...groups.keys()].sort()).toEqual([DEFAULT_GROUP, 'America/New_York', 'Europe/London'].sort());
    expect(groups.get('America/New_York').map((s) => s.email)).toEqual(['a@x.com', 'b@x.com']);
    expect(groups.get(DEFAULT_GROUP).map((s) => s.email)).toEqual(['d@x.com', 'e@x.com']);
  });

  it('routes invalid timezone values into the default group', () => {
    const groups = groupSubscribersByTimeZone([{ email: 'a@x.com', timeZone: 'Mars/OlympusMons' }]);
    expect(groups.get(DEFAULT_GROUP)).toHaveLength(1);
  });

  it('returns an empty map for no subscribers', () => {
    expect(groupSubscribersByTimeZone([]).size).toBe(0);
  });
});

describe('filterSubscribersForGroup', () => {
  const pool = [
    { email: 'ny@x.com', timeZone: 'America/New_York' },
    { email: 'london@x.com', timeZone: 'Europe/London' },
    { email: 'none@x.com' },
    { email: 'bad@x.com', timeZone: 'Mars/OlympusMons' }
  ];

  it('matches an exact timezone', () => {
    expect(filterSubscribersForGroup(pool, 'America/New_York').map((s) => s.email))
      .toEqual(['ny@x.com']);
  });

  it('default group takes missing and invalid timezones', () => {
    expect(filterSubscribersForGroup(pool, DEFAULT_GROUP).map((s) => s.email))
      .toEqual(['none@x.com', 'bad@x.com']);
  });

  it('catch-all takes everyone', () => {
    expect(filterSubscribersForGroup(pool, CATCH_ALL_GROUP)).toHaveLength(4);
  });

  it('every subscriber lands in exactly one non-catch-all group', () => {
    const groups = groupSubscribersByTimeZone(pool);
    const covered = [...groups.keys()]
      .flatMap((key) => filterSubscribersForGroup(pool, key).map((s) => s.email));
    expect(covered.sort()).toEqual(pool.map((s) => s.email).sort());
  });
});

describe('computeGroupSendTimes', () => {
  it('sends each zone at the default zone wall-clock time', () => {
    // Base: 9:00 AM America/New_York on 2026-01-15 (EST) = 14:00 UTC.
    const base = new Date('2026-01-15T14:00:00Z');
    const times = computeGroupSendTimes(base, 'America/New_York', [
      'America/New_York',
      'America/Los_Angeles',
      'Europe/London',
      DEFAULT_GROUP
    ]);

    // Default zone and default group fire exactly at the base instant.
    expect(times.get('America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(times.get(DEFAULT_GROUP).toISOString()).toBe('2026-01-15T14:00:00.000Z');
    // 9:00 AM PST = 17:00 UTC (3 hours after New York).
    expect(times.get('America/Los_Angeles').toISOString()).toBe('2026-01-15T17:00:00.000Z');
    // 9:00 AM London (GMT) = 09:00 UTC — earlier than the base instant.
    expect(times.get('Europe/London').toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('handles the default zone being in DST while a target zone is not', () => {
    // Base: 9:00 AM America/New_York on 2026-07-15 (EDT) = 13:00 UTC.
    const base = new Date('2026-07-15T13:00:00Z');
    const times = computeGroupSendTimes(base, 'America/New_York', ['Australia/Sydney']);
    // 9:00 AM AEST (winter, UTC+10) on Jul 15 = 2026-07-14T23:00:00Z.
    expect(times.get('Australia/Sydney').toISOString()).toBe('2026-07-14T23:00:00.000Z');
  });

  it('supports half-hour zones', () => {
    // Base: 9:00 AM UTC. Kolkata 9:00 AM = 03:30 UTC.
    const base = new Date('2026-01-15T09:00:00Z');
    const times = computeGroupSendTimes(base, 'UTC', ['Asia/Kolkata']);
    expect(times.get('Asia/Kolkata').toISOString()).toBe('2026-01-15T03:30:00.000Z');
  });
});
