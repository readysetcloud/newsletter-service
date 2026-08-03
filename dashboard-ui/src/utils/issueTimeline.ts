import type { TimelineEntry } from '@/types/issues';

/**
 * How long after a hand-off a send is still allowed to be silent.
 *
 * The hand-off is recorded by the publish workflow; the send itself happens in
 * a Lambda EventBridge invokes afterwards, which validates the sender and pages
 * the whole subscriber list before mailing anybody. Seconds to minutes of gap
 * is normal operation, not a fault, and a warning that fires during it would be
 * on screen for every healthy issue at the moment somebody is most likely to be
 * watching.
 */
const HANDOFF_GRACE_MS = 15 * 60 * 1000;

const detailString = (entry: TimelineEntry | undefined, key: string): string | null => {
  const value = entry?.detail?.[key];
  return typeof value === 'string' ? value : null;
};

/**
 * The gap worth calling out: an issue whose send was handed off and then never
 * actually sent anything, past the point where it still could.
 *
 * Not inferable from anything else on the page. The status says `published`,
 * the stats are all zero — which equally describes an issue sent moments ago —
 * and the progress record is absent, which equally describes an issue with
 * local send switched off. Only the sequence shows it, and only by something
 * being *missing*.
 *
 * Three things suppress it, and all three are cases where "no mail yet" is the
 * correct state rather than a fault:
 *
 * - A deferral that has not come due. Delivery is owed to a Scheduler entry at
 *   a known future instant; nothing is wrong until that instant passes.
 * - A fan-out still working. A local send reaches timezones over many hours and
 *   records nothing between planning and its first group firing. This is the
 *   normal state of a healthy local send for its whole first leg, and warning
 *   through it would make the warning meaningless.
 * - A hand-off inside the grace window. The send runs asynchronously after the
 *   hand-off is recorded, so a short silence is expected.
 *
 * @param entries The issue's timeline
 * @param now Injectable for tests
 * @returns The stall, with the instant delivery was promised for when known
 */
export const findStalledSend = (
  entries: TimelineEntry[],
  now: Date = new Date()
): { deferredUntil: string | null } | null => {
  const isHandOff = (entry: TimelineEntry) =>
    entry.type === 'send_handed_off' || entry.type === 'send_deferred';

  // The LAST hand-off, not the first: a resend adds another one, and measuring
  // the grace window from the original would declare a send that started
  // seconds ago to have been silent for days.
  const handOff = [...entries].reverse().find(isHandOff);
  if (!handOff) return null;

  const everSent = entries.some(
    (entry) => entry.type === 'sending_started' || entry.type === 'send_completed'
  );
  if (everSent) return null;

  const isPast = (instant: string | null) =>
    instant !== null && new Date(instant).getTime() <= now.getTime();

  // Delivery is owed to a Scheduler entry that has not fired yet.
  const deferredUntil = detailString(
    [...entries].reverse().find((entry) => entry.type === 'send_deferred'),
    'sendAt'
  );
  if (deferredUntil && !isPast(deferredUntil)) return null;

  // A fan-out is mid-flight. Its catch-all is the point everything should be
  // done by, so that — not the hand-off — is when silence becomes a fault.
  // A fan-out whose catch-all cannot be read suppresses the warning outright:
  // a missed alarm on an issue that is probably fine costs less than an alarm
  // on every healthy local send, which is what teaches people to ignore it.
  const fanOut = [...entries].reverse().find((entry) => entry.type === 'fanout_planned');
  if (fanOut && !isPast(detailString(fanOut, 'catchAllAt'))) return null;

  if (new Date(handOff.at).getTime() + HANDOFF_GRACE_MS > now.getTime()) return null;

  return { deferredUntil };
};
