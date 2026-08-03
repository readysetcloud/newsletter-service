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
import { humanizeGap } from '@/utils/issueTimeline';
import type { TimelineEntry, TimelineEventType } from '@/types/issues';

export interface IssueTimelineProps {
  entries: TimelineEntry[];
  /** Renders a day heading, e.g. "Monday, August 3, 2026". */
  formatLongDate: (value: string) => string;
  /** Renders a time of day in the newsletter's timezone. */
  formatTime: (value: string) => string;
  /** The zone those times are in, stated once so they are unambiguous. */
  timeZoneLabel?: string;
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

/** Events after which nothing more is expected to happen on its own. */
const TERMINAL_EVENTS = new Set(['send_completed', 'published', 'failed', 'unscheduled']);

/**
 * Whether the timeline is still expecting something.
 *
 * `send_completed` is written by the local-send progress tracker and by nothing
 * else, so an ordinary send has no terminal event of its own: its last entry is
 * `sending_started`, recorded once every SES call has returned. That routinely
 * sorts *after* the derived `published` — minutes after for a large list, a day
 * after for a deferred one — which left the panel reading "Still in progress"
 * forever for a send that had entirely finished.
 *
 * So terminality depends on who owns completion. With a fan-out in the
 * timeline, only `send_completed` ends it — the groups run for hours and an
 * early `sending_started` says nothing about the ones still queued. Without
 * one, a send event *is* the end of the story: one invocation mailed the list.
 */
const isFinished = (entries: TimelineEntry[]): boolean => {
  const last = entries[entries.length - 1];
  if (!last) return false;
  if (TERMINAL_EVENTS.has(String(last.type))) return true;

  const fannedOut = entries.some((entry) => entry.type === 'fanout_planned');
  return !fannedOut && last.type === 'sending_started';
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

const MARKER_STYLES: Record<Tone, string> = {
  neutral: 'bg-surface text-muted-foreground border-border',
  progress:
    'bg-primary-100 text-primary-700 border-primary-300 dark:bg-primary-900/40 dark:text-primary-200 dark:border-primary-700',
  good: 'bg-success-100 text-success-700 border-success-300 dark:bg-success-900/40 dark:text-success-200 dark:border-success-700',
  bad: 'bg-error-100 text-error-700 border-error-300 dark:bg-error-900/40 dark:text-error-200 dark:border-error-700'
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

interface RenderRow {
  entry: TimelineEntry;
  /** Day heading to print above this row, when it opens a new day. */
  day: string | null;
  /** Elapsed time since the previous event, when it is worth stating. */
  gap: string | null;
}

/**
 * What happened to an issue, and when, in order.
 *
 * The dashboard's other panels answer "what is true now" — the status badge,
 * the stats, the per-group progress. None of them can explain an issue that
 * says `published` while most of the list has not been mailed, because every
 * one of those readings is equally consistent with a healthy send. This panel
 * can, because it shows sequence and elapsed time: a fan-out that planned
 * fourteen groups and has fired four looks nothing like one that fired none.
 *
 * Entries render whether or not this build recognises them. An event the
 * backend has started recording and the frontend has not learned about yet is
 * still evidence, and dropping it would put a hole in exactly the sequence
 * somebody is reading to work out what went wrong.
 */
export const IssueTimeline: React.FC<IssueTimelineProps> = ({
  entries,
  formatLongDate,
  formatTime,
  timeZoneLabel,
  className
}) => {
  const rows = useMemo<RenderRow[]>(() => {
    // Defensive: the API sorts, but a timeline rendered out of order is
    // actively misleading rather than merely untidy, and being sure costs one
    // comparison per entry.
    const ordered = [...entries].sort((a, b) => a.at.localeCompare(b.at));

    // Each row is derived from its own entry and the one before it, read by
    // index. Threading the previous day/instant through a mutable closure would
    // be shorter and is what this used to do, but it makes the mapper depend on
    // the order it happens to be called in.
    return ordered.map((entry, index) => {
      const previous = index > 0 ? ordered[index - 1] : null;

      // Grouped by the rendered day string rather than by parsing dates: the
      // formatter already works in the newsletter's timezone, so two instants
      // on the same local day produce the same string by construction. Doing
      // the arithmetic here instead would be a second, disagreeing
      // implementation of the tenant's zone.
      const day = formatLongDate(entry.at);
      const previousDay = previous ? formatLongDate(previous.at) : null;

      const at = new Date(entry.at).getTime();
      const previousAt = previous ? new Date(previous.at).getTime() : NaN;

      return {
        entry,
        day: day === previousDay ? null : day,
        gap:
          Number.isFinite(at) && Number.isFinite(previousAt)
            ? humanizeGap(at - previousAt)
            : null
      };
    });
  }, [entries, formatLongDate]);

  const inFlight = useMemo(
    () => rows.length > 0 && !isFinished(rows.map((row) => row.entry)),
    [rows]
  );

  if (rows.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Nothing has been recorded for this issue yet.
      </p>
    );
  }

  return (
    <div className={className}>
      {timeZoneLabel && (
        <p className="text-xs text-muted-foreground mb-3">All times {timeZoneLabel}</p>
      )}

      <ol className="relative" aria-label="Issue timeline">
        {/* The rail. One continuous line behind every marker, rather than a
            segment per row, so day headings and gap markers sit *on* the
            timeline instead of interrupting it. */}
        <span
          className="absolute left-[15px] top-2 bottom-2 w-px bg-border"
          aria-hidden="true"
        />

        {rows.map(({ entry, day, gap }, index) => {
          const { label, icon: Icon, tone } = presentationFor(entry.type);

          return (
            <li key={`${entry.at}-${entry.type}-${index}`}>
              {day && (
                <div className={cn('relative flex items-center gap-3', index > 0 && 'pt-5')}>
                  {/* Masks the rail so the heading reads as a break in the day,
                      not a marker of its own. */}
                  <span className="w-8 flex justify-center bg-card z-10" aria-hidden="true">
                    <span className="h-2 w-2 rounded-full bg-border" />
                  </span>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {day}
                  </h4>
                </div>
              )}

              {gap && (
                <div className="relative flex items-center gap-3 py-1">
                  <span className="w-8 flex justify-center bg-card z-10" aria-hidden="true">
                    <span className="h-3 w-px border-l border-dashed border-border" />
                  </span>
                  <span className="text-[11px] text-muted-foreground italic">{gap}</span>
                </div>
              )}

              <div className={cn('relative flex gap-3', day || gap ? 'pt-2' : 'pt-4')}>
                <span
                  className={cn(
                    'relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2',
                    MARKER_STYLES[tone]
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>

                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <time
                      dateTime={entry.at}
                      className="text-sm font-semibold tabular-nums text-foreground"
                    >
                      {formatTime(entry.at)}
                    </time>
                    <span className="text-sm text-foreground">{label}</span>
                    {entry.derived && (
                      // Said out loud because a derived timestamp can be
                      // approximate — `failed` carries the record's last write,
                      // not the instant of failure — and somebody
                      // reconstructing a sequence needs to know which
                      // timestamps to trust.
                      <span
                        className="text-[11px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1"
                        title="Reconstructed from the issue record rather than recorded as it happened"
                      >
                        from record
                      </span>
                    )}
                    {entry.actor && entry.actor !== 'system' && (
                      <span className="text-xs text-muted-foreground">· {entry.actor}</span>
                    )}
                  </div>

                  <EntryDetail detail={entry.detail} />
                </div>
              </div>
            </li>
          );
        })}

        {/* Terminator. An issue whose last event is not terminal is still
            going — the single most useful thing this panel can say about a
            local send that has hours of timezones left to reach. */}
        <li className="relative flex gap-3 pt-4">
          <span
            className={cn(
              'relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-dashed',
              inFlight
                ? 'border-primary-400 text-primary-600 dark:text-primary-300'
                : 'border-border text-muted-foreground'
            )}
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                inFlight ? 'bg-primary-500 animate-pulse' : 'bg-border'
              )}
            />
          </span>
          <span className="self-center text-xs text-muted-foreground">
            {inFlight ? 'Still in progress' : 'Nothing further recorded'}
          </span>
        </li>
      </ol>
    </div>
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
    <dl className="mt-1.5 flex flex-wrap gap-1.5">
      {pairs.map(({ key, label, value }) => (
        <div
          key={key}
          className="flex min-w-0 items-baseline gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px]"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate max-w-[14rem] font-medium text-foreground" title={value}>
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
