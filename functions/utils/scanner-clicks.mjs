/**
 * Identifies clicks that came from automated link scanners rather than readers.
 *
 * Corporate mail security (Outlook SafeLinks, Proofpoint, Mimecast, Barracuda)
 * fetches every link in a message to check it before the recipient ever sees
 * the mail. Those fetches arrive on the same tracking URLs a reader would use,
 * carrying the same encrypted subscriber id, so they land in the click stream
 * indistinguishable from engagement at the level of a single event.
 *
 * What separates them is shape, not any one field: a scanner touches *many
 * distinct links in one burst*, because it is walking the message rather than
 * reading it. That is the only signal used here.
 *
 * Deliberately NOT used:
 *
 *   - User agent. Two of the three click paths never capture one — the
 *     CloudFront redirect functions log only the destination, source and IP —
 *     so a UA rule would silently apply to email clicks alone and quietly miss
 *     everything else. Shape is available on every path.
 *   - Time since publish. Scanners are fast, but so is an engaged reader on a
 *     morning send, and delivery is spread over minutes while `publishedAt` is
 *     a single instant. Speed alone convicts real readers.
 *
 * This module only classifies. It never mutates counters: callers record the
 * split alongside the raw totals, because the raw numbers are load-bearing
 * elsewhere (`describeCounterAnomaly` relies on scanner clicks putting a floor
 * under a healthy issue's click count) and because a heuristic you cannot
 * check against the unfiltered figure is a heuristic you cannot tune.
 */

/**
 * Distinct links one subscriber must touch inside the window before the burst
 * reads as a sweep.
 *
 * Four is deliberately above the two-or-three a curious reader might open in
 * quick succession from a link roundup, and well below the "every link in the
 * issue" a scanner takes. Raising it trades recall for precision.
 */
export const DEFAULT_MIN_DISTINCT_LINKS = 4;

/**
 * Width of the burst window, in seconds. Scanners typically finish a message in
 * under ten seconds; a minute is generous enough to absorb retries and queuing
 * without swallowing a reader working through an issue over a coffee.
 */
export const DEFAULT_WINDOW_SECONDS = 60;

/** Sort key value used for click events with no identifiable subscriber. */
const UNATTRIBUTED = 'unknown';

const toEpochSeconds = (timestamp) => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
};

/**
 * Find the clicks belonging to sweep bursts within one subscriber's timeline.
 *
 * Walks a window over the subscriber's clicks in time order. Whenever a window
 * holds at least `minDistinctLinks` distinct URLs, every click in it is part of
 * a sweep — including repeats of a URL already counted, since they arrived
 * inside the same automated pass.
 *
 * @param {object[]} clicks - One subscriber's clicks, ascending by time
 * @param {number} minDistinctLinks
 * @param {number} windowSeconds
 * @returns {Set<string>} `sk` values of clicks inside a burst
 */
const findBurstClicks = (clicks, minDistinctLinks, windowSeconds) => {
  const flagged = new Set();
  if (clicks.length < minDistinctLinks) return flagged;

  let start = 0;
  for (let end = 0; end < clicks.length; end++) {
    // Shrink from the left until the window is within range of the new click.
    while (clicks[end].at - clicks[start].at > windowSeconds) {
      start++;
    }

    const distinct = new Set();
    for (let i = start; i <= end; i++) {
      distinct.add(clicks[i].linkUrl);
    }

    if (distinct.size >= minDistinctLinks) {
      for (let i = start; i <= end; i++) {
        flagged.add(clicks[i].sk);
      }
    }
  }

  return flagged;
};

/**
 * Split an issue's click events into scanner-driven and reader-driven.
 *
 * Clicks with no subscriber attribution (`subscriberEmailHash` of "unknown" —
 * the web-version redirect path, where no encrypted id rides along) cannot be
 * grouped into a timeline and are reported separately rather than guessed at.
 * Counting them as human would overstate engagement; counting them as scanner
 * would condemn ordinary web readers.
 *
 * @param {object[]} clickEvents - Raw click events for one issue
 * @param {object} [options]
 * @param {number} [options.minDistinctLinks]
 * @param {number} [options.windowSeconds]
 * @returns {{ scannerClickIds: Set<string>, summary: object }}
 */
export function classifyScannerClicks(clickEvents, options = {}) {
  const minDistinctLinks = options.minDistinctLinks ?? DEFAULT_MIN_DISTINCT_LINKS;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  const bySubscriber = new Map();
  let unattributed = 0;

  for (const click of clickEvents ?? []) {
    const hash = click?.subscriberEmailHash;
    if (!hash || hash === UNATTRIBUTED) {
      unattributed++;
      continue;
    }

    const at = toEpochSeconds(click.timestamp);
    // An event we cannot place in time cannot be placed in a burst either.
    if (at === null) {
      unattributed++;
      continue;
    }

    if (!bySubscriber.has(hash)) bySubscriber.set(hash, []);
    bySubscriber.get(hash).push({
      sk: click.sk,
      at,
      linkUrl: click.linkUrl ?? UNATTRIBUTED
    });
  }

  const scannerClickIds = new Set();
  const scannerSubscribers = new Set();

  for (const [hash, clicks] of bySubscriber) {
    clicks.sort((a, b) => a.at - b.at);
    const burst = findBurstClicks(clicks, minDistinctLinks, windowSeconds);
    if (burst.size > 0) {
      scannerSubscribers.add(hash);
      for (const sk of burst) scannerClickIds.add(sk);
    }
  }

  const total = clickEvents?.length ?? 0;
  const scanner = scannerClickIds.size;
  const attributed = total - unattributed;
  const human = attributed - scanner;

  return {
    scannerClickIds,
    summary: {
      totalClicks: total,
      /** Clicks inside a sweep burst — almost certainly a link scanner. */
      scannerClicks: scanner,
      /** Attributed clicks that were not part of a sweep. */
      humanClicks: human,
      /**
       * Clicks with no subscriber id (web-version traffic) or no usable
       * timestamp. Neither classified nor discarded.
       */
      unattributedClicks: unattributed,
      /**
       * Scanner share of the clicks that could be classified at all. Null when
       * nothing was attributable, since 0% and "no data" are different answers.
       */
      scannerRate: attributed > 0 ? Math.round((scanner / attributed) * 1000) / 10 : null,
      /** Distinct subscribers whose clicks included at least one sweep. */
      scannerSubscribers: scannerSubscribers.size,
      thresholds: { minDistinctLinks, windowSeconds }
    }
  };
}
