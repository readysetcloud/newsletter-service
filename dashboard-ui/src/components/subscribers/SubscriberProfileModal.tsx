import React, { useEffect, useState } from 'react';
import { Sparkles, MailOpen, MousePointerClick, Bot } from 'lucide-react';
import { Modal, ModalHeader, ModalTitle, ModalDescription, ModalContent } from '@/components/ui/Modal';
import {
  getSortedInterestProfile,
  RECENCY_STYLES,
  AUTO_SEGMENT_THRESHOLD,
} from '@/utils/interestProfile';
import { getEngagementStatus } from '@/utils/engagement';
import { describeBotFlags, hasStrongBotSignal } from './botFlags';
import { subscriberService } from '@/services/subscriberService';
import type { SubscriberListItem, SubscriberDetail, ActivityEntry } from '@/types';
import { useTenantDateFormat } from '@/contexts/SettingsContext';
import { formatInTimeZone } from '@/utils/dateFormatting';

interface SubscriberProfileModalProps {
  subscriber: SubscriberListItem | null;
  latestIssueNumber: number;
  onClose: () => void;
}

const formatDate = (dateString: string, timeZone?: string) =>
  formatInTimeZone(dateString, timeZone, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }, 'en-US');

/** Shorten a URL to host + path for compact display; full URL goes in a title. */
const shortenUrl = (url?: string): string => {
  if (!url) return 'a link';
  let display = url;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    display = `${parsed.hostname}${path}`;
  } catch {
    // Not a parseable URL — fall back to the raw string.
  }
  return display.length > 40 ? `${display.slice(0, 39)}…` : display;
};

/** A short relative timestamp ("just now", "5h ago", "3d ago") with a date fallback. */
const formatRelative = (iso: string, timeZone?: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (diffMs < hour) return 'just now';
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  const days = Math.floor(diffMs / day);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso, timeZone);
};

const activityLabel = (entry: ActivityEntry): React.ReactNode => {
  if (entry.type === 'open') {
    return <>Opened issue #{entry.issue}</>;
  }
  return (
    <>
      Clicked{' '}
      <span className="text-foreground" title={entry.url}>
        {shortenUrl(entry.url)}
      </span>
    </>
  );
};

/**
 * A subscriber's "tiny profile": engagement recency/depth plus the interest
 * topics accumulated from their link clicks, with the topics that have reached
 * the auto-segmentation threshold called out.
 */
export const SubscriberProfileModal: React.FC<SubscriberProfileModalProps> = ({
  subscriber,
  latestIssueNumber,
  onClose,
}) => {
  // Dates render in the newsletter's timezone, not the viewer's.
  const { timeZone } = useTenantDateFormat();
  const [detail, setDetail] = useState<SubscriberDetail | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const email = subscriber?.email;

  // Load the activity timeline when the modal opens. subscriberService caches
  // detail per email and coalesces in-flight requests, so when the row was
  // prefetched on hover this resolves from cache and renders with no spinner.
  // On failure we keep whatever the list already gave us — the rest of the
  // modal renders regardless.
  useEffect(() => {
    if (!email) return;

    let cancelled = false;

    async function loadDetail(subscriberEmail: string) {
      setDetail(null);
      setActivityLoading(true);
      try {
        const res = await subscriberService.getSubscriber(subscriberEmail);
        if (!cancelled && res.success && res.data) {
          setDetail(res.data);
        }
      } catch {
        // Silent fallback — keep whatever the list already provided.
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    }

    loadDetail(email);

    return () => {
      cancelled = true;
    };
  }, [email]);

  if (!subscriber) return null;

  const name = [subscriber.firstName, subscriber.lastName].filter(Boolean).join(' ');
  const engagement = getEngagementStatus(subscriber.lastEngagedIssue, latestIssueNumber);
  const profile = getSortedInterestProfile(subscriber.interestScores);
  const autoSegmentTopics = profile.filter((entry) => entry.score >= AUTO_SEGMENT_THRESHOLD);
  const recentActivity = detail?.recentActivity ?? [];
  const botReasons = describeBotFlags(subscriber.botFlags);
  const strongBotSignal = hasStrongBotSignal(subscriber.botFlags);

  return (
    <Modal isOpen={!!subscriber} onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>
        {/* When a subscriber never gave a name we show a neutral label rather
            than surfacing their raw email address as if it were their name. */}
        <ModalTitle>{name || 'Unnamed subscriber'}</ModalTitle>
        <ModalDescription>{subscriber.email}</ModalDescription>
      </ModalHeader>
      <ModalContent className="space-y-6">
        {/* Why this subscriber is flagged — only present when something fired.
            This is what the "Suspected" chip on the list opens to. */}
        {botReasons.length > 0 && (
          <section className="rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-900 dark:bg-orange-900/10">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300 mb-2">
              <Bot className="w-3.5 h-3.5" aria-hidden="true" />
              {strongBotSignal ? 'Likely automated signup' : 'Possibly automated signup'}
            </h3>
            <ul className="space-y-2">
              {botReasons.map((reason) => (
                <li key={reason.key}>
                  <p className="text-sm font-medium text-foreground">{reason.label}</p>
                  <p className="text-xs text-muted-foreground leading-snug">{reason.description}</p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mt-3 leading-snug">
              {strongBotSignal
                ? 'These signals fired when the address signed up. Nothing here is blocked automatically except honeypot hits — the rest are recorded for review.'
                : 'Every signal here is circumstantial on its own. Treat this as worth a look rather than a verdict.'}
              {' '}Engagement is not a counter-argument: mail-security scanners fetch tracked
              links automatically, which counts as engagement on this list.
            </p>
          </section>
        )}

        {/* Engagement */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Engagement
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${engagement.className}`}>
              {engagement.text}
            </span>
            <span className="text-sm text-muted-foreground">
              {subscriber.engagementCount != null
                ? `${subscriber.engagementCount} issue${subscriber.engagementCount === 1 ? '' : 's'} engaged`
                : 'No engagement yet'}
            </span>
            {subscriber.lastEngagedIssue != null && (
              <span className="text-sm text-muted-foreground">
                Last: issue #{subscriber.lastEngagedIssue}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
            {subscriber.addedAt && <p>Subscribed {formatDate(subscriber.addedAt, timeZone)}</p>}
            {subscriber.timeZone && (
              <p title="Detected from engagement activity across 3 consecutive issues">
                Local timezone: {subscriber.timeZone} (auto-detected)
              </p>
            )}
          </div>
        </section>

        {/* Interest profile */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Interest Profile
          </h3>
          {profile.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No interest signal yet. Topics build up as this subscriber clicks tracked links in your issues.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {profile.map((entry) => (
                <li key={entry.topic} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    {entry.displayName}
                    {entry.score >= AUTO_SEGMENT_THRESHOLD && (
                      <Sparkles className="w-3.5 h-3.5 text-primary-500" aria-label="Reached auto-segment threshold" />
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground tabular-nums">{entry.score}</span>
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs ${RECENCY_STYLES[entry.recency]}`}>
                      {entry.recency}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {autoSegmentTopics.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Auto-segmented into{' '}
                {autoSegmentTopics.map((entry) => entry.displayName).join(', ')} (score {'>='} {AUTO_SEGMENT_THRESHOLD}).
              </span>
            </p>
          )}
        </section>

        {/* Recent activity */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Recent Activity
          </h3>
          {activityLoading ? (
            <p className="text-sm text-muted-foreground">Loading activity…</p>
          ) : recentActivity.length > 0 ? (
            <ul className="space-y-1.5">
              {recentActivity.map((entry, index) => (
                <li
                  key={`${entry.type}-${entry.issue}-${entry.ts}-${index}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  {entry.type === 'open' ? (
                    <MailOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-label="Open" />
                  ) : (
                    <MousePointerClick className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" aria-label="Click" />
                  )}
                  <span className="min-w-0 truncate">{activityLabel(entry)}</span>
                  <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                    {formatRelative(entry.ts, timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No recent activity recorded yet. Opens and clicks show up here as this subscriber engages with your issues.
            </p>
          )}
        </section>
      </ModalContent>
    </Modal>
  );
};

export default SubscriberProfileModal;
