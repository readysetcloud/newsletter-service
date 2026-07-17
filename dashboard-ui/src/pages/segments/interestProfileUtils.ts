/**
 * Interest-profile helpers for the Segments member view.
 *
 * The implementation now lives in the shared `@/utils/interestProfile` module so
 * the Subscribers view can reuse it. This file re-exports it to preserve the
 * existing import paths (and tests) under `pages/segments`.
 */
export {
  TOPIC_DISPLAY_NAMES,
  getTopicDisplayName,
  getRecencyStatus,
  getSortedInterestProfile,
  RECENCY_STYLES,
  AUTO_SEGMENT_THRESHOLD,
} from '@/utils/interestProfile';

export type {
  RecencyStatus,
  SortedInterestEntry,
  InterestScoreEntry,
} from '@/utils/interestProfile';
