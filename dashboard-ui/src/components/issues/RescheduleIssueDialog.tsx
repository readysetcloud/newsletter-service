import React, { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import {
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalContent,
  ModalFooter
} from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/utils/cn';
import { useTenantDateFormat, useTenantSettings } from '@/contexts/SettingsContext';
import { padSendTime } from '@/services/settingsService';
import {
  combineDateAndTimeInTimeZone,
  formatDateTimeInTimeZone,
  toDatetimeLocalInTimeZone
} from '@/utils/dateFormatting';
import type { Issue } from '@/types/issues';

/**
 * How the new send time is chosen.
 *
 * `default` sends the API a bare `YYYY-MM-DD` and lets it apply the tenant's
 * default send time — the same resolution a date-only schedule gets on create.
 * That is deliberate rather than a shortcut: resolving the day here and posting
 * an instant would make the dashboard a second implementation of a rule the API
 * owns, and the two would drift across a DST boundary.
 */
type ScheduleMode = 'default' | 'custom';

export interface RescheduleIssueDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The scheduled issue being moved. */
  issue: Pick<Issue, 'issueNumber' | 'subject' | 'scheduledAt'>;
  /**
   * Performs the reschedule. Receives exactly what should go to the API: a
   * bare date in `default` mode, an RFC3339 instant in `custom` mode. Rejects
   * to keep the dialog open with the error shown.
   */
  onSubmit: (scheduledAt: string) => Promise<void>;
}

/**
 * Moves an already-scheduled issue to a different send time.
 *
 * The dialog leads with the default-send-time option because that is the
 * common repair: an issue scheduled from a bare date that never picked up the
 * tenant's configured time — most visibly one that landed at midnight UTC,
 * which reads as the previous evening anywhere west of it.
 */
export const RescheduleIssueDialog: React.FC<RescheduleIssueDialogProps> = ({
  isOpen,
  onClose,
  issue,
  onSubmit
}) => {
  const { timeZone, formatDateTime } = useTenantDateFormat();
  const { defaultSendTime } = useTenantSettings();

  // The modal unmounts its children when closed, so these initialisers run
  // fresh on every open and the form always starts from the current schedule.
  const current = toDatetimeLocalInTimeZone(issue.scheduledAt, timeZone);
  const [mode, setMode] = useState<ScheduleMode>('default');
  const [date, setDate] = useState(current.slice(0, 10));
  const [time, setTime] = useState(current.slice(11, 16) || padSendTime(defaultSendTime));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sendTime = mode === 'default' ? padSendTime(defaultSendTime) : time;

  /**
   * What the chosen day and time come out as. In `default` mode this mirrors
   * what the API will resolve rather than deciding it — the resolvers agree by
   * construction (see `combineDateAndTimeInTimeZone`), and the response is
   * still the value the page adopts.
   */
  const preview = useMemo(() => {
    if (!date || !sendTime) return null;

    const instant = combineDateAndTimeInTimeZone(date, sendTime, timeZone);
    if (!instant) return null;

    return {
      instant,
      inTenantZone: formatDateTimeInTimeZone(instant, timeZone),
      inUtc: formatDateTimeInTimeZone(instant, 'UTC'),
      isPast: new Date(instant).getTime() <= Date.now()
    };
  }, [date, sendTime, timeZone]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!date) {
      setError('Pick a date for this issue to send.');
      return;
    }
    if (mode === 'custom' && !time) {
      setError('Pick a time of day for this issue to send.');
      return;
    }
    if (!preview) {
      setError("That date and time isn't a valid send time.");
      return;
    }
    if (preview.isPast) {
      setError('Pick a time in the future — a send cannot be moved into the past.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      // The bare date is the payload in default mode: the API applies the
      // tenant's default send time to it, which is the whole point of the
      // option.
      await onSubmit(mode === 'default' ? date : preview.instant);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move the send time.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md">
      <form onSubmit={handleSubmit}>
        <ModalHeader onClose={handleClose}>
          <ModalTitle>Change send time</ModalTitle>
          <ModalDescription>
            Issue #{issue.issueNumber} is currently scheduled for{' '}
            {formatDateTime(issue.scheduledAt)}.
          </ModalDescription>
        </ModalHeader>

        <ModalContent>
          <div className="space-y-4">
            <fieldset>
              <legend className="field-label mb-2">Send time</legend>
              <div className="space-y-2">
                <ModeOption
                  id="reschedule-mode-default"
                  checked={mode === 'default'}
                  onSelect={() => setMode('default')}
                  disabled={isSubmitting}
                  title="Use my default send time"
                  description={`Your newsletter default is ${padSendTime(defaultSendTime)} in ${timeZone}. The exact instant is worked out when you save.`}
                />
                <ModeOption
                  id="reschedule-mode-custom"
                  checked={mode === 'custom'}
                  onSelect={() => setMode('custom')}
                  disabled={isSubmitting}
                  title="Pick a specific time"
                  description="Choose the time of day yourself, in your newsletter timezone."
                />
              </div>
            </fieldset>

            <div className={cn('grid gap-4', mode === 'custom' ? 'sm:grid-cols-2' : 'sm:max-w-xs')}>
              <Input
                label="Date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={isSubmitting}
              />
              {mode === 'custom' && (
                <Input
                  label="Time of day"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  disabled={isSubmitting}
                />
              )}
            </div>

            {preview && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  This issue would send at
                </p>
                <p className="text-sm text-muted-foreground mt-1">{preview.inTenantZone}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{preview.inUtc}</p>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-error-600">
                {error}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              A send can only be moved while it is still waiting. Once the issue starts going out,
              unscheduling is the only way to stop it.
            </p>
          </div>
        </ModalContent>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Moving…' : 'Change send time'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

interface ModeOptionProps {
  id: string;
  checked: boolean;
  onSelect: () => void;
  disabled: boolean;
  title: string;
  description: string;
}

/** One choice, as a card: radio, its label, and what choosing it means. */
const ModeOption: React.FC<ModeOptionProps> = ({
  id,
  checked,
  onSelect,
  disabled,
  title,
  description
}) => (
  <div
    className={cn(
      'flex gap-3 items-start p-3 rounded-lg border transition-colors',
      checked
        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
        : 'border-border hover:bg-surface',
      disabled && 'opacity-60'
    )}
  >
    <input
      id={id}
      type="radio"
      name="reschedule-mode"
      className="mt-1"
      checked={checked}
      onChange={onSelect}
      disabled={disabled}
      aria-describedby={`${id}-description`}
    />
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground cursor-pointer">
        {title}
      </label>
      <p id={`${id}-description`} className="text-xs text-muted-foreground mt-0.5">
        {description}
      </p>
    </div>
  </div>
);
