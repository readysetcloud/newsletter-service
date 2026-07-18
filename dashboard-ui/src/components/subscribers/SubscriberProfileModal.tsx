import React, { useEffect, useState } from 'react';
import { Sparkles, MailOpen, MousePointerClick } from 'lucide-react';
import { Modal, ModalHeader, ModalTitle, ModalDescription, ModalContent } from '@/components/ui/Modal';
import {
  getSortedInterestProfile,
  RECENCY_STYLES,
  AUTO_SEGMENT_THRESHOLD,
} from '@/utils/interestProfile';
import { getEngagementStatus } from '@/utils/engagement';
import { subscriberService } from '@/services/subscriberService';
import type { SubscriberListItem, SubscriberDetail, ActivityEntry } from '@/types';

interface SubscriberProfileModalProps {
  subscriber: SubscriberListItem | null;
  latestIssueNumber: number;
  onClose: () => void;
}

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

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
const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (diffMs < hour) return 'just now';
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  const days = Math.floor(diffMs / day);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
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
  const [detail, setDetail] = useState<SubscriberDetail | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const email = subscriber?.email;

  // Fetch the full detail (activity timeline) when the modal opens for a
  // subscriber. On failure we silently fall back to what the list already
  // provided — the rest of the modal renders regardless.
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

  return (
    <Modal isOpen={!!subscriber} onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>
        <ModalTitle>{name || subscriber.email}</ModalTitle>
        {name && <ModalDescription>{subscriber.email}</ModalDescription>}
      </ModalHeader>
      <ModalContent className="space-y-6">
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
            {subscriber.addedAt && <p>Subscribed {formatDate(subscriber.addedAt)}</p>}
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
          ) : detail && detail.recentActivity.length > 0 ? (
            <ul className="space-y-1.5">
              {detail.recentActivity.map((entry, index) => (
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
                    {formatRelative(entry.ts)}
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
