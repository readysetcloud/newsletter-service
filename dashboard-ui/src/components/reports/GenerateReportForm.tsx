import React, { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export interface GenerateReportFormProps {
  /** Starts the report. Resolves once it has been accepted, not once it is done. */
  onGenerate: (range: { periodStart: string; periodEnd: string }) => Promise<void>;
  /** True while a request is in flight, or while the tenant is at their limit. */
  disabled?: boolean;
  /** Why generating is unavailable, shown in place of the hint. */
  disabledReason?: string;
}

/** `YYYY-MM-DD` for a date offset from today. */
const dayOffset = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Longest range the API will accept, mirrored here so the picker can say so. */
const MAX_SPAN_DAYS = 366;

const daysBetween = (start: string, end: string): number =>
  Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);

/**
 * Picks a range and starts a report over it.
 *
 * The dates are days, not instants: the server reads them in the newsletter's
 * own timezone, so "1 June" means their 1 June wherever this is opened from.
 * The end date the person picks is the last day they expect to be *included*,
 * which is one day before the exclusive end the API takes — the conversion
 * happens here rather than asking anyone to think about it.
 */
export const GenerateReportForm: React.FC<GenerateReportFormProps> = ({
  onGenerate,
  disabled = false,
  disabledReason
}) => {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => dayOffset(-30));
  const [to, setTo] = useState(() => dayOffset(-1));
  const [submitting, setSubmitting] = useState(false);

  const today = dayOffset(0);

  const problem = useMemo(() => {
    if (!from || !to) return 'Pick both dates.';
    if (to < from) return 'The end date comes before the start date.';
    if (to > today) return 'The end date is in the future.';
    const span = daysBetween(from, to) + 1;
    if (span > MAX_SPAN_DAYS) {
      return `That is ${span} days. A report can cover at most ${MAX_SPAN_DAYS}.`;
    }
    return null;
  }, [from, to, today]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (problem || disabled) return;

    setSubmitting(true);
    try {
      // The picker's end date is inclusive; the API's is not.
      await onGenerate({ periodStart: from, periodEnd: dayAfter(to) });
      setOpen(false);
    } catch {
      // Left open on purpose, holding the dates that were picked, so a retry
      // does not start from scratch. Saying what went wrong belongs to the
      // caller, which knows whether this was a refusal or a dropped request.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">Generate a report</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {disabledReason
              ?? 'Monthly reports run on the 1st. Pick any range to run one now.'}
          </p>
        </div>
        {!open && (
          <Button
            variant="primary"
            onClick={() => setOpen(true)}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
          >
            <CalendarRange className="w-4 h-4 mr-2" aria-hidden="true" />
            New report
          </Button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="flex flex-col gap-3 pt-4 border-t border-border">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <Input
              type="date"
              label="From"
              value={from}
              max={today}
              onChange={(event) => setFrom(event.target.value)}
              className="sm:w-44"
            />
            <Input
              type="date"
              label="To"
              value={to}
              max={today}
              onChange={(event) => setTo(event.target.value)}
              className="sm:w-44"
            />
            <div className="flex gap-2 sm:ml-auto">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" isLoading={submitting} disabled={!!problem || disabled || submitting}>
                Generate
              </Button>
            </div>
          </div>

          <p className={`text-xs ${problem ? 'text-error-600 dark:text-error-400' : 'text-muted-foreground'}`}>
            {problem
              ?? disabledReason
              ?? 'Both dates are included. Reports run in the background and appear in the list below.'}
          </p>
        </form>
      )}
    </div>
  );
};

/** The day after `date`, as `YYYY-MM-DD`. */
const dayAfter = (date: string): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

export default GenerateReportForm;
