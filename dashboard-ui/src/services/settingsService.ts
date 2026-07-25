import { apiClient } from './api';
import { SEND_TIME_PATTERN } from '@/schemas/settingsSchema';
import type { ApiResponse } from '@/types/api';
import type { SettingsResponse, UpdateSettingsRequest } from '@/types/settings';

/**
 * Settings Service — the tenant-wide defaults used when a request doesn't
 * specify a value (see `/settings` in `openapi.yaml`).
 */
export class SettingsService {
  /**
   * Load the tenant's effective settings along with the system defaults they
   * fall back to.
   */
  async getSettings(): Promise<ApiResponse<SettingsResponse>> {
    return apiClient.get<SettingsResponse>('/settings');
  }

  /**
   * Update one or more settings. Omitted keys are left unchanged; a key sent
   * as `null` resets that setting to the system default.
   */
  async updateSettings(data: UpdateSettingsRequest): Promise<ApiResponse<SettingsResponse>> {
    const validationError = this.validateSettings(data);
    if (validationError) {
      return { success: false, error: validationError, errorCode: 'VALIDATION_ERROR' };
    }

    if (Object.keys(data).length === 0) {
      return {
        success: false,
        error: 'At least one setting must be provided',
        errorCode: 'VALIDATION_ERROR'
      };
    }

    return apiClient.put<SettingsResponse>('/settings', this.normalize(data));
  }

  /**
   * Validate the settings that are present. Returns an error message or null.
   * `null` values are resets and are always valid.
   */
  validateSettings(data: UpdateSettingsRequest): string | null {
    if (typeof data.timezone === 'string' && data.timezone.trim()) {
      if (!isValidTimeZone(data.timezone.trim())) {
        return `"${data.timezone}" is not a recognized timezone`;
      }
    }

    if (typeof data.defaultSendTime === 'string' && data.defaultSendTime.trim()) {
      if (!SEND_TIME_PATTERN.test(data.defaultSendTime.trim())) {
        return 'Default send time must be a 24-hour time, like 09:00';
      }
    }

    return null;
  }

  /**
   * Trim strings and zero-pad the send time so what we send matches the
   * canonical form the backend stores.
   */
  private normalize(data: UpdateSettingsRequest): UpdateSettingsRequest {
    const normalized: UpdateSettingsRequest = {};

    if ('timezone' in data) {
      const value = typeof data.timezone === 'string' ? data.timezone.trim() : data.timezone;
      normalized.timezone = value ? value : null;
    }

    if ('defaultSendTime' in data) {
      const value =
        typeof data.defaultSendTime === 'string' ? data.defaultSendTime.trim() : data.defaultSendTime;
      normalized.defaultSendTime = value ? padSendTime(value) : null;
    }

    return normalized;
  }
}

/** `9:05` → `09:05`. Leaves anything unrecognized alone for the API to reject. */
export function padSendTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/**
 * Whether the backend will accept this zone.
 *
 * `Intl` alone is too lenient: it takes legacy aliases like `CST` that the
 * backend's IANA database rejects. When the browser can enumerate zones, the
 * name must be one of the canonical ones; otherwise we fall back to asking
 * `Intl` whether it can construct a formatter at all.
 */
export function isValidTimeZone(timeZone: string): boolean {
  const supported = (
    Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;

  if (typeof supported === 'function') {
    try {
      const zones = supported.call(Intl, 'timeZone');
      if (Array.isArray(zones) && zones.length > 0) {
        // UTC is universally valid but is not always in the enumerated list.
        return timeZone === 'UTC' || zones.includes(timeZone);
      }
    } catch {
      // Fall through to the permissive check below.
    }
  }

  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const settingsService = new SettingsService();
