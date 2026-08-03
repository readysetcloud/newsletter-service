import React, { useMemo } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  Clock,
  FilePlus2,
  FileText,
  Hourglass,
  PlayCircle,
  RefreshCw,
  Send,
  Share2,
  XCircle
} from 'lucide-react';
import { cn } from '@/utils/cn';
import type { TimelineEntry, TimelineEventType } from '@/types/issues';

export interface IssueTimelineProps {
  entries: TimelineEntry[];
  /** Renders an instant in the newsletter's timezone. */
  formatDateTime: (value: string) => string;
  className?: string;
}

type Tone = 'neutral' | 'progress' | 'good' | 'bad';

interface EventPresentation {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
}

const PRESENTATION: Record<string, EventPresentation> = {
  created: { label: 'Draft created', icon: FilePlus2, tone: 'neutral' },
  updated: { label: 'Content edited', icon: FileText, tone: 'neutral' },
  scheduled: { label: 'Send scheduled', icon: CalendarClock, tone: 'neutral' },
  rescheduled: { label: 'Send time changed', icon: Clock, tone: 'neutral' },
  unscheduled: { label: 'Send cancelled', icon: CalendarX, tone: 'bad' },
  workflow_started: { label: 'Publish workflow started', icon: PlayCircle, tone: 'progress' },
  send_handed_off: { label: 'Handed to the send path', icon: Share2, tone: 'progress' },
  send_deferred: { label: 'Delivery deferred', icon: Hourglass, tone: 'progress' },
  fanout_planned: { label: 'Local send fanned out', icon: Share2, tone: 'progress' },
  sending_started: { label: 'Emails sent', icon: Send, tone: 'good' },
  send_completed: { label: 'All groups delivered', icon: CheckCircle2, tone: 'good' },
  resend_requested: { label: 'Resend requested', icon: RefreshCw, tone: 'progress' },
  published: { label: 'Marked published', icon: CheckCircle2, tone: 'good' },
  failed: { label: 'Publish failed', icon: XCircle, tone: 'bad' }
};

/** An event the backend knows about and this build does not. */
const unknownPresentation = (type: string): EventPresentation => ({
  // Underscores out, so a new backend event still reads as English rather than
  // as a symbol leaking through the UI.
  label: type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
  icon: Clock,
  tone: 'neutral'
});

const presentationFor = (type: TimelineEventType): EventPresentation =>
  PRESENTATION[type] ?? unknownPresentation(String(type));

const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-surface text-muted-foreground border-border',
  progress: 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-900/40',
  good: 'bg-success-50 text-success-700 border-success-200 dark:bg-success-900/20 dark:text-success-300 dark:border-success-900/40',
  bad: 'bg-error-50 text-error-700 border-error-200 dark:bg-error-900/20 dark:text-error-300 dark:border-error-900/40'
};

/** Detail keys worth spelling out, in the order they read best. */
const DETAIL_LABELS: Record<string, string> = {
  sendAt: 'Send time',
  from: 'Was',
  reason: 'Cause',
  recipients: 'Recipients',
  skipped: 'Already sent',
  subscribers: 'Subscribers',
  groups: 'Groups',
  immediate: 'Sending now',
  scheduled: 'Scheduled',
  catchAllAt: 'Final sweep',
  mode: 'Mode',
  group: 'Group',
  variant: 'Variant',
  sender: 'From',
  contentType: 'Format',
  scheduleName: 'Schedule',
  abTest: 'A/B test',
  localSend: 'Local send'
};

const DETAIL_ORDER = Object.keys(DETAIL_LABELS);

const formatDetailValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
};

/**
 * What actually happened to an issue, in order.
 *
 * The dashboard's other panels all answer "what is true now" — the status
 * badge, the stats, the per-group progress. None of them can explain an issue
 * that says `published` while nobody received it, because every one of those
 * numbers is consistent with that state. This is the panel that can: it shows
 * the hand-off to the send path and the deferral that followed it, and then
 * nothing, which is the actual shape of that failure.
 *
 * Entries are rendered whether or not this build recognises them. An event the
 * backend has started recording and the frontend has not learned about yet is
 * still evidence, and dropping it would put a hole in exactly the sequence
 * somebody is reading to work out what went wrong.
 */
export const IssueTimeline: React.FC<IssueTimelineProps> = ({
  entries,
  formatDateTime,
  className
}) => {
  // Defensive: the API sorts, but a timeline rendered out of order is actively
  // misleading rather than merely untidy, and the cost of being sure is one
  // comparison per entry.
  const ordered = useMemo(
    () => [...entries].sort((a, b) => a.at.localeCompare(b.at)),
    [entries]
  );

  if (ordered.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Nothing has been recorded for this issue yet.
      </p>
    );
  }

  return (
    <ol className={cn('space-y-0', className)} aria-label="Issue timeline">
      {ordered.map((entry, index) => {
        const { label, icon: Icon, tone } = presentationFor(entry.type);
        const isLast = index === ordered.length - 1;

        return (
          <li key={`${entry.at}-${entry.type}-${index}`} className="flex gap-3">
            {/* Rail: the marker, and the line joining it to the next event. */}
            <div className="flex flex-col items-center flex-shrink-0">
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border',
                  TONE_STYLES[tone]
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              {!isLast && <span className="w-px flex-1 bg-border min-h-[1rem]" aria-hidden="true" />}
            </div>

            <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-5')}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-foreground">{label}</span>
                {entry.derived && (
                  // Said out loud because a derived timestamp can be
                  // approximate — `failed` carries the record's last write,
                  // not the instant of failure — and somebody reconstructing a
                  // sequence needs to know which timestamps to trust.
                  <span
                    className="text-[11px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1"
                    title="Reconstructed from the issue record rather than recorded as it happened"
                  >
                    from record
                  </span>
                )}
              </div>

              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDateTime(entry.at)}
                {entry.actor && entry.actor !== 'system' && <> · {entry.actor}</>}
              </p>

              <EntryDetail detail={entry.detail} />
            </div>
          </li>
        );
      })}
    </ol>
  );
};

const EntryDetail: React.FC<{ detail?: Record<string, unknown> }> = ({ detail }) => {
  const pairs = useMemo(() => {
    if (!detail) return [];

    const keys = Object.keys(detail);
    // Known keys first in their documented order, then anything the backend
    // added that this build has no opinion about — shown rather than dropped.
    const known = DETAIL_ORDER.filter((key) => keys.includes(key));
    const rest = keys.filter((key) => !DETAIL_ORDER.includes(key)).sort();

    return [...known, ...rest].map((key) => ({
      key,
      label: DETAIL_LABELS[key] ?? key,
      value: formatDetailValue(detail[key])
    }));
  }, [detail]);

  if (pairs.length === 0) return null;

  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
      {pairs.map(({ key, label, value }) => (
        <div key={key} className="flex gap-1 text-xs min-w-0">
          <dt className="text-muted-foreground">{label}:</dt>
          <dd className="text-foreground truncate max-w-[16rem]" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
};

export const IssueTimelineStalledWarning: React.FC<{
  stalled: { deferredUntil: string | null };
  formatDateTime: (value: string) => string;
}> = ({ stalled, formatDateTime }) => (
  <div
    role="alert"
    className="mb-4 rounded-lg border border-warning-200 bg-warning-50 dark:border-warning-900/40 dark:bg-warning-900/20 p-3"
  >
    <p className="text-sm font-medium text-foreground flex items-center gap-2">
      <AlertTriangle
        className="h-4 w-4 text-warning-600 dark:text-warning-500"
        aria-hidden="true"
      />
      This issue was handed off but never sent
    </p>
    <p className="text-xs text-muted-foreground mt-1">
      {stalled.deferredUntil
        ? `Delivery was deferred to ${formatDateTime(stalled.deferredUntil)} and no email followed.`
        : 'The send path took the issue and no email followed.'}{' '}
      Sending it again will reach everyone who never received it.
    </p>
  </div>
);
