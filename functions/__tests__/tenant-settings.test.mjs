import { jest } from '@jest/globals';
import {
  DEFAULT_SETTINGS,
  isDateOnly,
  resolveSendInstant,
  renderTokens,
  buildSubject,
  buildIssueUrl
} from '../utils/tenant-settings.mjs';

const settings = (overrides = {}) => ({ ...DEFAULT_SETTINGS, ...overrides });

describe('tenant-settings', () => {
  describe('isDateOnly', () => {
    it('recognizes a bare date string', () => {
      expect(isDateOnly('2026-08-01')).toBe(true);
      expect(isDateOnly('  2026-08-01  ')).toBe(true);
      expect(isDateOnly('2026-08-01T09:00:00Z')).toBe(false);
      expect(isDateOnly('not a date')).toBe(false);
    });

    it('recognizes the UTC-midnight Date a YAML parser produces from a bare date', () => {
      expect(isDateOnly(new Date('2026-08-01T00:00:00.000Z'))).toBe(true);
      expect(isDateOnly(new Date('2026-08-01T12:00:00.000Z'))).toBe(false);
      expect(isDateOnly(new Date('nope'))).toBe(false);
    });
  });

  describe('resolveSendInstant', () => {
    it('anchors a bare date to the default send time in the tenant zone', () => {
      const resolved = resolveSendInstant(
        '2026-08-01',
        settings({ timezone: 'America/Chicago', defaultSendTime: '09:00' })
      );

      // 09:00 CDT is 14:00Z.
      expect(resolved.toISOString()).toBe('2026-08-01T14:00:00.000Z');
    });

    it('follows daylight saving rather than a fixed offset', () => {
      const winter = resolveSendInstant(
        '2026-01-15',
        settings({ timezone: 'America/Chicago', defaultSendTime: '09:00' })
      );

      expect(winter.toISOString()).toBe('2026-01-15T15:00:00.000Z');
    });

    it('defaults to 09:00 UTC when the tenant has configured nothing', () => {
      expect(resolveSendInstant('2026-08-01', DEFAULT_SETTINGS).toISOString())
        .toBe('2026-08-01T09:00:00.000Z');
    });

    it('resolves the UTC-midnight Date form the same way', () => {
      const resolved = resolveSendInstant(
        new Date('2026-08-01T00:00:00.000Z'),
        settings({ timezone: 'America/Chicago', defaultSendTime: '09:00' })
      );

      expect(resolved.toISOString()).toBe('2026-08-01T14:00:00.000Z');
    });

    it('respects a date that already names a time', () => {
      // Settings fill in what the caller left out; they don't override a
      // caller who was specific.
      const resolved = resolveSendInstant(
        '2026-08-01T18:30:00Z',
        settings({ timezone: 'America/Chicago', defaultSendTime: '09:00' })
      );

      expect(resolved.toISOString()).toBe('2026-08-01T18:30:00.000Z');
    });

    it('zero-pads a single-digit send time', () => {
      const resolved = resolveSendInstant('2026-08-01', settings({ defaultSendTime: '7:05' }));
      expect(resolved.toISOString()).toBe('2026-08-01T07:05:00.000Z');
    });

    it('falls back to UTC when the stored zone is unusable', () => {
      const resolved = resolveSendInstant(
        '2026-08-01',
        settings({ timezone: 'Not/AZone', defaultSendTime: '09:00' })
      );

      expect(resolved.toISOString()).toBe('2026-08-01T09:00:00.000Z');
    });

    it('falls back to the system send time when the stored one is malformed', () => {
      const resolved = resolveSendInstant('2026-08-01', settings({ defaultSendTime: '9am' }));
      expect(resolved.toISOString()).toBe('2026-08-01T09:00:00.000Z');
    });

    it('resolves a gap send time forward, never backward', () => {
      // 02:00–02:59 never happens on 2026-03-08 in Chicago. Applying offsets
      // naively lands on 01:30 CST — an hour EARLIER than the tenant asked
      // for, which would send a GitHub-imported issue ahead of schedule. The
      // first minute that exists is 03:00 CDT.
      const resolved = resolveSendInstant(
        '2026-03-08',
        settings({ timezone: 'America/Chicago', defaultSendTime: '02:30' })
      );

      expect(resolved.toISOString()).toBe('2026-03-08T08:00:00.000Z');
      expect(resolved.getTime()).toBeGreaterThan(new Date('2026-03-08T07:30:00.000Z').getTime());
    });

    it('agrees with the Rust and dashboard resolvers across a whole gap', () => {
      // settings.rs, dateFormatting.ts and this module all resolve a gap to
      // the same instant; if they drifted, the settings preview would
      // contradict the send.
      for (const sendTime of ['02:00', '02:01', '02:30', '02:59']) {
        expect(
          resolveSendInstant(
            '2026-03-08',
            settings({ timezone: 'America/Chicago', defaultSendTime: sendTime })
          ).toISOString()
        ).toBe('2026-03-08T08:00:00.000Z');
      }
    });

    it('resolves a gap in a zone that shifts by half an hour', () => {
      // Lord Howe springs forward 30 minutes, so its gap is 02:00–02:29.
      const resolved = resolveSendInstant(
        '2026-10-04',
        settings({ timezone: 'Australia/Lord_Howe', defaultSendTime: '02:15' })
      );

      expect(resolved.toISOString()).toBe('2026-10-03T15:30:00.000Z');
    });

    it('keeps the earlier instant for an ambiguous fall-back hour', () => {
      // 01:30 happens twice on 2026-11-01; the earlier occurrence is closest
      // to the requested wall clock, matching the Rust resolver.
      const resolved = resolveSendInstant(
        '2026-11-01',
        settings({ timezone: 'America/Chicago', defaultSendTime: '01:30' })
      );

      expect(resolved.toISOString()).toBe('2026-11-01T06:30:00.000Z');
    });

    it('returns null for missing or unusable values', () => {
      for (const bad of [null, undefined, '', 'tomorrow', new Date('nope')]) {
        expect(resolveSendInstant(bad, DEFAULT_SETTINGS)).toBeNull();
      }
    });
  });

  describe('renderTokens', () => {
    it('substitutes known tokens, with or without inner spaces', () => {
      expect(renderTokens('{{title}} #{{number}}', { title: 'Hi', number: 7 })).toBe('Hi #7');
      expect(renderTokens('{{ title }}', { title: 'Hi' })).toBe('Hi');
    });

    it('leaves an unknown token visible instead of blanking it', () => {
      // A typo should look wrong, not silently swallow part of the subject.
      expect(renderTokens('{{title}} {{brand}}', { title: 'Hi' })).toBe('Hi {{brand}}');
    });

    it('returns an empty string for a non-string template', () => {
      expect(renderTokens(undefined, {})).toBe('');
      expect(renderTokens(null, {})).toBe('');
    });
  });

  describe('buildSubject', () => {
    it('prefers a subject the caller actually supplied', () => {
      const subject = buildSubject(settings({ subjectTemplate: '{{title}} | Weekly' }), {
        callerSubject: 'Explicit subject',
        title: 'The Title',
        number: 12
      });

      expect(subject).toBe('Explicit subject');
    });

    it('falls back to the tenant template when no subject was supplied', () => {
      const subject = buildSubject(
        settings({ subjectTemplate: '{{title}} | Picks of the Week #{{number}}' }),
        { title: 'The Title', number: 12 }
      );

      expect(subject).toBe('The Title | Picks of the Week #12');
    });

    it('falls back to the title when there is no template either', () => {
      expect(buildSubject(DEFAULT_SETTINGS, { title: 'The Title', number: 12 }))
        .toBe('The Title');
    });

    it('falls back to a generic subject when there is no title', () => {
      expect(buildSubject(DEFAULT_SETTINGS, { number: 12 })).toBe('Newsletter Issue #12');
    });

    it('treats a blank caller subject as absent', () => {
      expect(buildSubject(settings({ subjectTemplate: 'From the template' }), {
        callerSubject: '   ',
        title: 'The Title'
      })).toBe('From the template');
    });
  });

  describe('buildIssueUrl', () => {
    it('expands the tenant pattern', () => {
      expect(buildIssueUrl(settings({ issueUrlPattern: 'https://example.com/n/{{number}}' }), {
        number: 42
      })).toBe('https://example.com/n/42');
    });

    it('returns null when no pattern is configured', () => {
      // Better no link than a link to somebody else's site.
      expect(buildIssueUrl(DEFAULT_SETTINGS, { number: 42 })).toBeNull();
      expect(buildIssueUrl(settings({ issueUrlPattern: '  ' }), { number: 42 })).toBeNull();
      expect(buildIssueUrl(undefined, { number: 42 })).toBeNull();
    });
  });

  describe('getTenantSettings', () => {
    afterEach(() => {
      jest.resetModules();
    });

    it('returns the defaults without a lookup when there is no tenant id', async () => {
      const { getTenantSettings } = await import('../utils/tenant-settings.mjs');
      await expect(getTenantSettings(undefined)).resolves.toEqual(DEFAULT_SETTINGS);
    });
  });
});
