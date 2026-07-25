import { describe, it, expect } from 'vitest';
import {
  combineDateAndTimeInTimeZone,
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  formatTimeInTimeZone,
  fromDatetimeLocalInTimeZone,
  getTimeZoneAbbreviation,
  toDatetimeLocalInTimeZone
} from '../dateFormatting';

describe('dateFormatting', () => {
  describe('formatting', () => {
    it('renders an instant as wall-clock time in the given zone', () => {
      // 14:00Z is 9am in Chicago during daylight saving.
      const instant = '2026-08-01T14:00:00Z';

      expect(formatDateInTimeZone(instant, 'America/Chicago')).toBe('Aug 1, 2026');
      expect(formatTimeInTimeZone(instant, 'America/Chicago')).toBe('9:00 AM');
      expect(formatDateTimeInTimeZone(instant, 'America/Chicago')).toContain('9:00 AM');
    });

    it('shows a different day when the zone puts the instant on one', () => {
      // 23:00 Chicago on Jul 31 is already Aug 1 in UTC.
      const instant = '2026-08-01T04:00:00Z';

      expect(formatDateInTimeZone(instant, 'UTC')).toBe('Aug 1, 2026');
      expect(formatDateInTimeZone(instant, 'America/Chicago')).toBe('Jul 31, 2026');
    });

    it('labels the zone on a date-time so the reader knows whose clock it is', () => {
      expect(formatDateTimeInTimeZone('2026-08-01T14:00:00Z', 'America/Chicago')).toContain('CDT');
      expect(formatDateTimeInTimeZone('2026-01-15T15:00:00Z', 'America/Chicago')).toContain('CST');
    });

    it('formats empty and unparseable values as an empty string', () => {
      for (const bad of ['', '   not a date', null, undefined]) {
        expect(formatDateInTimeZone(bad, 'UTC')).toBe('');
        expect(formatDateTimeInTimeZone(bad, 'UTC')).toBe('');
        expect(formatTimeInTimeZone(bad, 'UTC')).toBe('');
      }
    });

    it('falls back to the browser zone rather than throwing on a bad zone', () => {
      expect(formatDateInTimeZone('2026-08-01T14:00:00Z', 'Not/AZone')).not.toBe('');
    });

    it('reports the zone abbreviation in effect at the given instant', () => {
      expect(getTimeZoneAbbreviation('America/Chicago', '2026-08-01T14:00:00Z')).toBe('CDT');
      expect(getTimeZoneAbbreviation('America/Chicago', '2026-01-15T15:00:00Z')).toBe('CST');
    });
  });

  describe('datetime-local conversion', () => {
    it('renders an instant as the zone wall clock a date input expects', () => {
      expect(toDatetimeLocalInTimeZone('2026-08-01T14:00:00Z', 'America/Chicago')).toBe(
        '2026-08-01T09:00'
      );
      expect(toDatetimeLocalInTimeZone('2026-08-01T14:00:00Z', 'UTC')).toBe('2026-08-01T14:00');
      expect(toDatetimeLocalInTimeZone('2026-08-01T14:00:00Z', 'Asia/Tokyo')).toBe(
        '2026-08-01T23:00'
      );
    });

    it('reads a wall-clock string back as the instant it names', () => {
      expect(fromDatetimeLocalInTimeZone('2026-08-01T09:00', 'America/Chicago')).toBe(
        '2026-08-01T14:00:00.000Z'
      );
      expect(fromDatetimeLocalInTimeZone('2026-08-01T09:00', 'UTC')).toBe(
        '2026-08-01T09:00:00.000Z'
      );
    });

    it('round-trips through both directions', () => {
      const instant = '2026-11-14T23:30:00.000Z';
      for (const zone of ['UTC', 'America/Chicago', 'Asia/Tokyo', 'Australia/Sydney']) {
        const local = toDatetimeLocalInTimeZone(instant, zone);
        expect(fromDatetimeLocalInTimeZone(local, zone)).toBe(instant);
      }
    });

    it('uses the offset in effect on the date, not today\'s offset', () => {
      // The same wall-clock time is UTC-5 in summer and UTC-6 in winter. A
      // single fixed offset would put one of these an hour off.
      expect(fromDatetimeLocalInTimeZone('2026-07-01T09:00', 'America/Chicago')).toBe(
        '2026-07-01T14:00:00.000Z'
      );
      expect(fromDatetimeLocalInTimeZone('2026-01-01T09:00', 'America/Chicago')).toBe(
        '2026-01-01T15:00:00.000Z'
      );
    });

    it('resolves a wall-clock time an hour after the spring-forward gap correctly', () => {
      // US spring forward 2026 is March 8. 03:30 local exists and is CDT.
      expect(fromDatetimeLocalInTimeZone('2026-03-08T03:30', 'America/Chicago')).toBe(
        '2026-03-08T08:30:00.000Z'
      );
    });

    it('returns an empty string for empty input', () => {
      expect(toDatetimeLocalInTimeZone('', 'UTC')).toBe('');
      expect(fromDatetimeLocalInTimeZone('', 'UTC')).toBe('');
      expect(fromDatetimeLocalInTimeZone('not-a-date', 'UTC')).toBe('');
    });
  });

  describe('combineDateAndTimeInTimeZone', () => {
    it('mirrors how the API resolves a date-only send', () => {
      // The browser-side equivalent of settings.rs `resolve_date_only`.
      expect(combineDateAndTimeInTimeZone('2026-08-01', '09:00', 'America/Chicago')).toBe(
        '2026-08-01T14:00:00.000Z'
      );
      expect(combineDateAndTimeInTimeZone('2026-01-15', '09:00', 'America/Chicago')).toBe(
        '2026-01-15T15:00:00.000Z'
      );
      expect(combineDateAndTimeInTimeZone('2026-08-01', '09:00', 'UTC')).toBe(
        '2026-08-01T09:00:00.000Z'
      );
    });

    it('returns an empty string when either half is missing', () => {
      expect(combineDateAndTimeInTimeZone('', '09:00', 'UTC')).toBe('');
      expect(combineDateAndTimeInTimeZone('2026-08-01', '', 'UTC')).toBe('');
    });
  });
});
