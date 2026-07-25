import { useEffect, useMemo, useState } from 'react';
import { ClockIcon, EnvelopeIcon, GlobeAltIcon, LinkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import { Card } from '@/components/ui/Card';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SkeletonLoader } from '@/components/ui/LoadingStates';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/contexts/SettingsContext';
import {
  SEND_TIME_PRESETS,
  SUBJECT_TOKENS,
  URL_TOKENS,
  findUnknownToken,
  getTimezoneOptions,
  tenantSettingsSchema,
  type TenantSettingsFormData
} from '@/schemas/settingsSchema';
import { padSendTime } from '@/services/settingsService';
import {
  combineDateAndTimeInTimeZone,
  formatDateTimeInTimeZone,
  formatLongDateInTimeZone,
  getBrowserTimeZone
} from '@/utils/dateFormatting';
import { renderTokens } from '@/utils/renderTokens';

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
  const { settings, configured, isTimeZoneInferred, defaults, updatedAt, isLoading, error, refresh, save } =
    useSettings();
  const { addToast } = useToast();

  const browserTimeZone = useMemo(() => getBrowserTimeZone(), []);

  // The optional templates are absent when unset; the form works in empty
  // strings and converts back on save.
  const toForm = (value: typeof settings): TenantSettingsFormData => ({
    timezone: value.timezone,
    defaultSendTime: value.defaultSendTime,
    subjectTemplate: value.subjectTemplate ?? '',
    issueUrlPattern: value.issueUrlPattern ?? ''
  });

  const [form, setForm] = useState<TenantSettingsFormData>(() => toForm(settings));
  const [errors, setErrors] = useState<Partial<Record<keyof TenantSettingsFormData, string>>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Adopt whatever the provider settles on (initial load, or a refresh). The
  // provider already substitutes the browser zone when the tenant has never
  // picked one, so an unconfigured newsletter opens on a sensible suggestion
  // that one Save turns into a real setting.
  useEffect(() => {
    setForm(toForm(settings));
    setErrors({});
    // toForm is a pure projection of `settings`; re-running on its identity
    // would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // A zone inferred from the browser has never been saved, so the form is
    // meaningfully ahead of the stored settings from the first render.
    isTimeZoneInferred ||
    form.timezone !== settings.timezone ||
    form.defaultSendTime !== settings.defaultSendTime ||
    form.subjectTemplate !== (settings.subjectTemplate ?? '') ||
    form.issueUrlPattern !== (settings.issueUrlPattern ?? '');

  const usingDefaultSendTime = !configured.includes('defaultSendTime');

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

  /**
   * Sample renderings, so the effect of a placeholder is visible before an
   * issue goes out with it. Sample values are obviously fake on purpose.
   */
  const subjectPreview = useMemo(() => {
    const template = form.subjectTemplate.trim();
    if (!template || findUnknownToken(template, SUBJECT_TOKENS)) return null;
    return renderTokens(template, {
      title: 'Serverless Patterns That Scale',
      number: 128,
      date: formatLongDateInTimeZone(new Date(), form.timezone)
    });
  }, [form.subjectTemplate, form.timezone]);

  const urlPreview = useMemo(() => {
    const pattern = form.issueUrlPattern.trim();
    if (!pattern || findUnknownToken(pattern, URL_TOKENS)) return null;
    return renderTokens(pattern, { number: 128 });
  }, [form.issueUrlPattern]);

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
        defaultSendTime: padSendTime(parsed.data.defaultSendTime),
        // Empty means "clear this"; the service turns it into an explicit null.
        subjectTemplate: parsed.data.subjectTemplate,
        issueUrlPattern: parsed.data.issueUrlPattern
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
    setForm(toForm(settings));
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
    <div className="space-y-4 sm:space-y-6">
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

      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        <Card className="p-4 sm:p-6">
          <div className="flex items-start gap-3 mb-4 sm:mb-6">
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
              isTimeZoneInferred
                ? `Detected from your browser. Save to use it for scheduling too — until then, dates without a time send at ${defaults.defaultSendTime} ${defaults.timezone}.`
                : undefined
            }
          />

          {form.timezone !== browserTimeZone && (
            <p className="text-sm text-muted-foreground mt-3">
              Your browser is in {browserTimeZone}.{' '}
              <button
                type="button"
                className="text-primary-600 hover:text-primary-700 underline min-h-[44px] sm:min-h-0 inline-flex items-center"
                onClick={() => handleChange('timezone', browserTimeZone)}
                disabled={isSaving}
              >
                Use that instead
              </button>
            </p>
          )}
        </Card>

        <Card className="p-4 sm:p-6">
          <div className="flex items-start gap-3 mb-4 sm:mb-6">
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

          <div className="w-full sm:max-w-xs">
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
                className={cn(
                  // 44px minimum so the chips are comfortably tappable.
                  'min-h-[44px] px-4 text-sm rounded-full border transition-colors',
                  padSendTime(form.defaultSendTime) === preset.value
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-border text-muted-foreground hover:bg-surface'
                )}
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

        <Card className="p-4 sm:p-6">
          <div className="flex items-start gap-3 mb-4 sm:mb-6">
            <EnvelopeIcon className="h-6 w-6 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Subject line format</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Used when the request that stages an issue doesn&rsquo;t supply a subject &mdash;
                which is every issue imported from GitHub. A subject sent with the request always
                wins. Leave empty to use the issue title on its own.
              </p>
            </div>
          </div>

          <Input
            label="Format"
            value={form.subjectTemplate}
            onChange={(event) => handleChange('subjectTemplate', event.target.value)}
            error={errors.subjectTemplate}
            disabled={isSaving}
            placeholder="{{title}} | Picks of the Week #{{number}}"
            helperText={`Available placeholders: ${SUBJECT_TOKENS.map((t) => `{{${t}}}`).join(', ')}`}
            autoCorrect="off"
            spellCheck={false}
          />

          {subjectPreview && (
            <div className="mt-4 rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-muted-foreground">A subject would look like</p>
              <p className="text-sm font-medium text-foreground mt-1 break-words">{subjectPreview}</p>
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-6">
          <div className="flex items-start gap-3 mb-4 sm:mb-6">
            <LinkIcon className="h-6 w-6 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Issue URL</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Where issues live on your own site. It becomes the &ldquo;view online&rdquo; link in
                the email. Leave empty and the link is left out entirely.
              </p>
            </div>
          </div>

          <Input
            label="URL pattern"
            value={form.issueUrlPattern}
            onChange={(event) => handleChange('issueUrlPattern', event.target.value)}
            error={errors.issueUrlPattern}
            disabled={isSaving}
            placeholder="https://example.com/newsletter/{{number}}"
            helperText="Must include {{number}} so each issue links to its own page."
            // A phone keyboard would otherwise capitalize and autocorrect a URL.
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />

          {urlPreview && (
            <div className="mt-4 rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-muted-foreground">Issue 128 would link to</p>
              <p className="text-sm font-medium text-foreground mt-1 break-all">{urlPreview}</p>
            </div>
          )}
        </Card>

        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted-foreground order-2 sm:order-1">
            {updatedAt
              ? `Last saved ${formatDateTimeInTimeZone(updatedAt, settings.timezone)}`
              : 'These settings have never been saved — everything is on system defaults.'}
          </p>

          {/* Stacked and full-width on a phone, with the primary action on top
              so it sits under the thumb rather than below a secondary button. */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 order-1 sm:order-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleReset}
              disabled={!isDirty || isSaving}
              className="w-full sm:w-auto"
            >
              Discard changes
            </Button>
            <Button
              type="submit"
              disabled={!isDirty || isSaving}
              isLoading={isSaving}
              className="w-full sm:w-auto"
            >
              {isSaving ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
