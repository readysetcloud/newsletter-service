import React from 'react';
import {
  getSortedInterestProfile,
  RECENCY_STYLES,
  type InterestScoreEntry,
} from '@/utils/interestProfile';

interface InterestChipsProps {
  interestScores?: Record<string, InterestScoreEntry> | null;
  /** Maximum chips to render before collapsing the rest into a "+N" chip. */
  max?: number;
  /** Placeholder rendered when the subscriber has no interest scores. */
  emptyLabel?: string;
}

/**
 * Compact, recency-coloured interest topic chips for a subscriber. Reuses the
 * same styling as the segment member view so a subscriber's interest signal
 * reads consistently everywhere it appears.
 */
export const InterestChips: React.FC<InterestChipsProps> = ({
  interestScores,
  max = 3,
  emptyLabel = '—',
}) => {
  const profile = getSortedInterestProfile(interestScores);

  if (profile.length === 0) {
    return <span className="text-muted-foreground">{emptyLabel}</span>;
  }

  const visible = profile.slice(0, max);
  const hiddenCount = profile.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((entry) => (
        <span
          key={entry.topic}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${RECENCY_STYLES[entry.recency]}`}
          title={`${entry.displayName}: ${entry.score} (${entry.recency})`}
        >
          {entry.displayName} <span className="font-medium">{entry.score}</span>
        </span>
      ))}
      {hiddenCount > 0 && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground"
          title={`${hiddenCount} more topic${hiddenCount === 1 ? '' : 's'}`}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  );
};

export default InterestChips;
