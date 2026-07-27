import { z } from 'zod';
import { timezoneOptions } from './profileSchema';

/**
 * Mirrors the backend's `HH:MM` validation so a bad value is caught in the
 * form rather than coming back as a 400.
 */
export const SEND_TIME_PATTERN = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Placeholders each template understands. Mirrors the backend's token
 * validation so a typo is caught in the form rather than coming back as a 400.
 */
export const SUBJECT_TOKENS = ['title', 'number', 'date'] as const;
export const URL_TOKENS = ['number'] as const;

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** Returns the first placeholder in `value` that isn't in `allowed`. */
export function findUnknownToken(value: string, allowed: readonly string[]): string | null {
  for (const match of value.matchAll(TOKEN_PATTERN)) {
    if (!allowed.includes(match[1])) {
      return match[1];
    }
  }
  return null;
}

export const tenantSettingsSchema = z.object({
  timezone: z
    .string()
    .min(1, 'Select a timezone'),
  defaultSendTime: z
    .string()
    .min(1, 'Enter a default send time')
    .regex(SEND_TIME_PATTERN, 'Enter a 24-hour time, like 09:00'),
  // Both templates are optional: an empty field clears the setting rather than
  // saving a blank one.
  subjectTemplate: z
    .string()
    .max(300, 'Keep the subject format under 300 characters')
    .refine((value) => !/[\r\n]/.test(value), 'Subject formats cannot contain line breaks')
    .superRefine((value, ctx) => {
      const unknown = findUnknownToken(value, SUBJECT_TOKENS);
      if (unknown) {
        ctx.addIssue({
          code: 'custom',
          message: `{{${unknown}}} isn't available — use ${SUBJECT_TOKENS.map((t) => `{{${t}}}`).join(', ')}`
        });
      }
    }),
  issueUrlPattern: z
    .string()
    .max(500, 'Keep the URL under 500 characters')
    .refine(
      (value) => value === '' || /^https?:\/\//.test(value),
      'Enter a full URL starting with https://'
    )
    .refine(
      (value) => value === '' || value.includes('{{number}}'),
      'Include {{number}} so each issue links to its own page'
    )
    .superRefine((value, ctx) => {
      const unknown = findUnknownToken(value, URL_TOKENS);
      if (unknown) {
        ctx.addIssue({
          code: 'custom',
          message: `{{${unknown}}} isn't available here — only {{number}}`
        });
      }
    })
});

export type TenantSettingsFormData = z.infer<typeof tenantSettingsSchema>;

/**
 * The full IANA zone list when the browser can enumerate it (Chrome 99+,
 * Safari 15.4+, Firefox 93+), falling back to the curated shortlist the
 * profile form already uses. A newsletter's zone is a one-time choice, so
 * offering every zone beats making someone settle for the nearest listed one.
 */
export function getTimezoneOptions(): Array<{ value: string; label: string }> {
  const supported = (
    Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;

  if (typeof supported !== 'function') {
    return timezoneOptions;
  }

  try {
    const zones = supported.call(Intl, 'timeZone');
    if (!Array.isArray(zones) || zones.length === 0) {
      return timezoneOptions;
    }
    return zones.map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }));
  } catch {
    return timezoneOptions;
  }
}

/**
 * Common newsletter send times, offered as quick picks alongside the free-form
 * time input.
 */
export const SEND_TIME_PRESETS = [
  { value: '06:00', label: '6:00 AM' },
  { value: '08:00', label: '8:00 AM' },
  { value: '09:00', label: '9:00 AM' },
  { value: '10:00', label: '10:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '17:00', label: '5:00 PM' }
];
