import { z } from 'zod';
import { timezoneOptions } from './profileSchema';

/**
 * Mirrors the backend's `HH:MM` validation so a bad value is caught in the
 * form rather than coming back as a 400.
 */
export const SEND_TIME_PATTERN = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

export const tenantSettingsSchema = z.object({
  timezone: z
    .string()
    .min(1, 'Select a timezone'),
  defaultSendTime: z
    .string()
    .min(1, 'Enter a default send time')
    .regex(SEND_TIME_PATTERN, 'Enter a 24-hour time, like 09:00')
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
