/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { settingsService } from '@/services/settingsService';
import {
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  formatLongDateInTimeZone,
  formatTimeInTimeZone,
  getTimeZoneAbbreviation,
  type DateInput
} from '@/utils/dateFormatting';
import type { SettingsResponse, TenantSettings, UpdateSettingsRequest } from '@/types/settings';

/**
 * What the app falls back to before settings have loaded, and if the request
 * fails. Kept in step with the backend's own defaults (`settings.rs`) so a
 * page that renders during the initial fetch doesn't briefly show times in a
 * different zone than the one it settles on.
 */
export const FALLBACK_SETTINGS: TenantSettings = {
  timezone: 'UTC',
  defaultSendTime: '09:00'
};

interface SettingsContextValue {
  /** Effective settings — never null, so callers don't need a loading branch. */
  settings: TenantSettings;
  /** System defaults, for marking which effective values are inherited. */
  defaults: TenantSettings;
  /** When settings were last saved; undefined if they never have been. */
  updatedAt?: string;
  isLoading: boolean;
  error: string | null;
  /** Re-read settings from the API. */
  refresh: () => Promise<void>;
  /** Save a partial update and adopt the result app-wide. */
  save: (update: UpdateSettingsRequest) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

interface SettingsProviderProps {
  children: ReactNode;
}

/**
 * Loads the tenant's settings once per session and shares them with every
 * page, so timezone-aware formatting doesn't cost a request per component.
 */
export function SettingsProvider({ children }: SettingsProviderProps) {
  const { isAuthenticated } = useAuth();
  const [response, setResponse] = useState<SettingsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await settingsService.getSettings();
      if (result.success && result.data) {
        setResponse(result.data);
      } else {
        setError(result.error || 'Failed to load settings');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      // Signing out clears the cached tenant values rather than leaking them
      // into the next session in this tab.
      setResponse(null);
      setError(null);
      return;
    }
    void load();
  }, [isAuthenticated, load]);

  const save = useCallback(async (update: UpdateSettingsRequest) => {
    const result = await settingsService.updateSettings(update);
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to save settings');
    }
    setResponse(result.data);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings: response?.settings ?? FALLBACK_SETTINGS,
      defaults: response?.defaults ?? FALLBACK_SETTINGS,
      updatedAt: response?.updatedAt,
      isLoading,
      error,
      refresh: load,
      save
    }),
    [response, isLoading, error, load, save]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/**
 * The full settings store, including `save` and `refresh`. Requires a
 * provider: a component that writes settings has no sensible fallback.
 */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

/**
 * Read-only access to the tenant's settings that degrades to the fallbacks
 * outside a provider. Formatting a date is not a good enough reason to crash a
 * page (or to make every test that renders one wire up a provider), so the
 * read path stays lenient where the write path above does not.
 */
export function useTenantSettings(): TenantSettings {
  return useContext(SettingsContext)?.settings ?? FALLBACK_SETTINGS;
}

/**
 * Formatters bound to the tenant's configured timezone. Use these instead of
 * `toLocaleString` so every surface reports the same wall clock — the one the
 * newsletter is actually scheduled against.
 */
export function useTenantDateFormat() {
  const timeZone = useTenantSettings().timezone;

  return useMemo(
    () => ({
      timeZone,
      /** `Aug 1, 2026` */
      formatDate: (value: DateInput) => formatDateInTimeZone(value, timeZone),
      /** `August 1, 2026` */
      formatLongDate: (value: DateInput) => formatLongDateInTimeZone(value, timeZone),
      /** `9:00 AM` */
      formatTime: (value: DateInput) => formatTimeInTimeZone(value, timeZone),
      /** `Aug 1, 2026, 9:00 AM CDT` */
      formatDateTime: (value: DateInput) => formatDateTimeInTimeZone(value, timeZone),
      /** `CDT` — the zone label in effect at the given instant. */
      timeZoneLabel: (value?: DateInput) => getTimeZoneAbbreviation(timeZone, value)
    }),
    [timeZone]
  );
}
