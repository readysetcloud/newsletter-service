import { useEffect, useMemo, useState } from 'react';
import { ClockIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SkeletonLoader } from '@/components/ui/LoadingStates';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/contexts/SettingsContext';
import {
  SEND_TIME_PRESETS,
  getTimezoneOptions,
  tenantSettingsSchema,
  type TenantSettingsFormData
} from '@/schemas/settingsSchema';
import { padSendTime } from '@/services/settingsService';
import {
  combineDateAndTimeInTimeZone,
  formatDateTimeInTimeZone,
  getBrowserTimeZone
} from '@/utils/dateFormatting';

/**
 * Tenant-wide defaults. Everything here answers the same question: what should
 * the platform do when a request doesn't say?
 *
 * The page deliberately shows a live preview of the resolved send instant —
 * "a date-only send lands here" — because the whole point of these two
 * settings is that they combine into a moment in time, and a timezone picker
 * on its own gives no feedback about whether you picked the right one.
 */
export function SettingsPage() {
  const { settings, defaults, updatedAt, isLoading, error, refresh, save } = useSettings();
  const { addToast } = useToast();

  const browserTimeZone = useMemo(() => getBrowserTimeZone(), []);

  const [form, setForm] = useState<TenantSettingsFormData>(settings);
  const [errors, setErrors] = useState<Partial<Record<keyof TenantSettingsFormData, string>>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Adopt whatever the provider settles on (initial load, or a refresh).
  useEffect(() => {
    setForm(settings);
    setErrors({});
  }, [settings]);

  /**
   * A `<select>` whose value isn't among its options silently displays the
   * first one instead — which would show the wrong zone and save it on the
   * next submit. Whatever the tenant currently has is always offered, even if
   * this browser doesn't enumerate it.
   */
  const timezoneOptions = useMemo(() => {
    const options = getTimezoneOptions();
    if (!form.timezone || options.some((option) => option.value === form.timezone)) {
      return options;
    }
    return [{ value: form.timezone, label: form.timezone.replace(/_/g, ' ') }, ...options];
  }, [form.timezone]);

  const isDirty =
    form.timezone !== settings.timezone || form.defaultSendTime !== settings.defaultSendTime;

  const usingDefaultTimezone = settings.timezone === defaults.timezone && !updatedAt;
  const usingDefaultSendTime = settings.defaultSendTime === defaults.defaultSendTime && !updatedAt;

  /**
   * Where a date-only send would land under the values currently in the form.
   * Uses tomorrow's date so the example is always a real upcoming send rather
   * than a time that has already passed today.
   */
  const preview = useMemo(() => {
    const parsed = tenantSettingsSchema.safeParse(form);
    if (!parsed.success) return null;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().slice(0, 10);

    const instant = combineDateAndTimeInTimeZone(
      date,
      padSendTime(form.defaultSendTime),
      form.timezone
    );
    if (!instant) return null;

    return {
      date,
      inTenantZone: formatDateTimeInTimeZone(instant, form.timezone),
      inUtc: formatDateTimeInTimeZone(instant, 'UTC')
    };
  }, [form]);

  const handleChange = <K extends keyof TenantSettingsFormData>(
    field: K,
    value: TenantSettingsFormData[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const parsed = tenantSettingsSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<keyof TenantSettingsFormData, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof TenantSettingsFormData;
        fieldErrors[field] = fieldErrors[field] ?? issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setIsSaving(true);
    try {
      await save({
        timezone: parsed.data.timezone,
        defaultSendTime: padSendTime(parsed.data.defaultSendTime)
      });
      addToast({
        type: 'success',
        title: 'Settings saved',
        message: 'New issues will use these defaults.'
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Could not save settings',
        message: err instanceof Error ? err.message : 'Please try again.'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setForm(settings);
    setErrors({});
  };

  if (isLoading && !updatedAt) {
    return (
      <div className="space-y-6">
        <SkeletonLoader count={3} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-2 text-sm sm:text-base">
          Defaults the platform falls back to when an API request doesn&rsquo;t spell a value out.
          Anything a request does specify always wins.
        </p>
      </div>

      {error && (
        <ErrorDisplay
          title="Could not load settings"
          message={error}
          severity="error"
          retryable
          onRetry={() => {
            void refresh();
          }}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-6">
          <div className="flex items-start gap-3 mb-6">
            <GlobeAltIcon className="h-6 w-6 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Timezone</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Dates and times across the dashboard are shown in this zone, and it&rsquo;s the zone a
                send date is read against.
              </p>
            </div>
          </div>

          <Select
            label="Newsletter timezone"
            value={form.timezone}
            onChange={(event) => handleChange('timezone', event.target.value)}
            options={timezoneOptions}
            error={errors.timezone}
            disabled={isSaving}
            helperText={
              usingDefaultTimezone
                ? `Currently using the system default (${defaults.timezone}).`
                : undefined
            }
          />

          {form.timezone !== browserTimeZone && (
            <p className="text-sm text-muted-foreground mt-3">
              Your browser is in {browserTimeZone}.{' '}
              <button
                type="button"
                className="text-primary-600 hover:text-primary-700 underline"
                onClick={() => handleChange('timezone', browserTimeZone)}
                disabled={isSaving}
              >
                Use that instead
              </button>
            </p>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-start gap-3 mb-6">
            <ClockIcon className="h-6 w-6 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Default send time</h2>
              <p className="text-sm text-muted-foreground mt-1">
                When a request schedules an issue with a date but no time &mdash; a bare{' '}
                <code className="text-xs">2026-08-01</code> &mdash; the send lands at this time of
                day in your newsletter timezone.
              </p>
            </div>
          </div>

          <div className="max-w-xs">
            <Input
              label="Time of day"
              type="time"
              value={form.defaultSendTime}
              onChange={(event) => handleChange('defaultSendTime', event.target.value)}
              error={errors.defaultSendTime}
              disabled={isSaving}
              helperText={
                usingDefaultSendTime
                  ? `Currently using the system default (${defaults.defaultSendTime}).`
                  : undefined
              }
            />
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            {SEND_TIME_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => handleChange('defaultSendTime', preset.value)}
                disabled={isSaving}
                aria-pressed={padSendTime(form.defaultSendTime) === preset.value}
                className={
                  padSendTime(form.defaultSendTime) === preset.value
                    ? 'px-3 py-1 text-sm rounded-full border border-primary-500 bg-primary-50 text-primary-700'
                    : 'px-3 py-1 text-sm rounded-full border border-border text-muted-foreground hover:bg-surface'
                }
              >
                {preset.label}
              </button>
            ))}
          </div>

          {preview && (
            <div className="mt-6 rounded-lg border border-border bg-surface p-4">
              <p className="text-sm font-medium text-foreground">
                An issue scheduled for <code className="text-xs">{preview.date}</code> would send at
              </p>
              <p className="text-sm text-muted-foreground mt-1">{preview.inTenantZone}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{preview.inUtc}</p>
            </div>
          )}
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {updatedAt
              ? `Last saved ${formatDateTimeInTimeZone(updatedAt, settings.timezone)}`
              : 'These settings have never been saved — everything is on system defaults.'}
          </p>

          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={handleReset} disabled={!isDirty || isSaving}>
              Discard changes
            </Button>
            <Button type="submit" disabled={!isDirty || isSaving} isLoading={isSaving}>
              {isSaving ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
