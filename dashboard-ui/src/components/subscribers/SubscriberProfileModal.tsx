import React from 'react';
import { Sparkles } from 'lucide-react';
import { Modal, ModalHeader, ModalTitle, ModalDescription, ModalContent } from '@/components/ui/Modal';
import {
  getSortedInterestProfile,
  RECENCY_STYLES,
  AUTO_SEGMENT_THRESHOLD,
} from '@/utils/interestProfile';
import { getEngagementStatus } from '@/utils/engagement';
import type { SubscriberListItem } from '@/types';

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
      </ModalContent>
    </Modal>
  );
};

export default SubscriberProfileModal;
