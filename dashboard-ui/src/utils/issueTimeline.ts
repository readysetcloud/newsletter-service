import type { TimelineEntry } from '@/types/issues';

/**
 * The gap worth calling out: an issue whose send was handed off or deferred and
 * then never actually sent anything.
 *
 * This is the issue-227 shape. It is not inferable from the status
 * (`published`), the stats (all zero, which equally describes an issue sent
 * moments ago), or the progress record (absent, which equally describes an
 * issue with local send switched off). Only the sequence shows it, and only by
 * something being *missing* — so the page states it rather than leaving it to
 * be noticed.
 *
 * Deliberately quiet while a deferral is still pending: a send waiting for its
 * scheduled instant is indistinguishable from one that will never fire, and the
 * only thing separating them is whether that instant has passed. Warning early
 * would fire on every healthy scheduled issue for the whole lead-time window,
 * which teaches everyone to ignore the warning that matters.
 *
 * @param entries The issue's timeline
 * @param now Injectable for tests
 * @returns The stall, with the instant delivery was promised for when known
 */
export const findStalledSend = (
  entries: TimelineEntry[],
  now: Date = new Date()
): { deferredUntil: string | null } | null => {
  const handedOff = entries.some(
    (entry) => entry.type === 'send_handed_off' || entry.type === 'send_deferred'
  );
  if (!handedOff) return null;

  const everSent = entries.some(
    (entry) => entry.type === 'sending_started' || entry.type === 'send_completed'
  );
  if (everSent) return null;

  const deferral = entries.find((entry) => entry.type === 'send_deferred');
  const deferredUntil =
    typeof deferral?.detail?.sendAt === 'string' ? deferral.detail.sendAt : null;

  // Still waiting on its own schedule — nothing is wrong yet.
  if (deferredUntil && new Date(deferredUntil).getTime() > now.getTime()) {
    return null;
  }

  return { deferredUntil };
};
