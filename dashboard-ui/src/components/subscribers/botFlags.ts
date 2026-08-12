import type { BotFlags } from '@/types';

/**
 * How much weight a single signal deserves on its own.
 *
 * `strong` signals are ones a real subscriber essentially cannot trip by
 * accident. `weak` ones are circumstantial — they correlate with automation but
 * have mundane explanations too, so a subscriber carrying only weak signals is
 * a candidate for review, not a verdict.
 */
export type BotSignalStrength = 'strong' | 'weak';

export interface BotFlagReason {
  key: keyof BotFlags;
  label: string;
  /** What the signal actually measures, and how it can misfire. */
  description: string;
  strength: BotSignalStrength;
}

/**
 * The five signup signals, in descending order of how much they should move
 * your judgement. Order is fixed rather than derived so the reasons list reads
 * the same way every time.
 *
 * Kept in sync with `functions/utils/bot-protection.mjs` (detection) and
 * `functions/src/api/controllers/subscribers.rs` (the `suspectedBot` OR).
 */
const REASONS: readonly BotFlagReason[] = [
  {
    key: 'honeypotTriggered',
    label: 'Honeypot triggered',
    description:
      'The signup form has a decoy field that is invisible to a person. This submission filled it in, which a human browser will not do. The strongest signal here.',
    strength: 'strong',
  },
  {
    key: 'disposableDomain',
    label: 'Disposable email domain',
    description:
      'The address is on a known throwaway-mailbox provider. Occasionally a privacy-conscious reader, but far more often a signup that will never be read.',
    strength: 'strong',
  },
  {
    key: 'suspiciousEmailPattern',
    label: 'Suspicious email pattern',
    description:
      'A Gmail address with three or more dots in the local part. Gmail ignores those dots, so one mailbox can generate unlimited distinct-looking addresses from the same inbox.',
    strength: 'weak',
  },
  {
    key: 'fastSubmission',
    label: 'Fast form submission',
    description:
      'The form was submitted less than 1.5 seconds after it rendered. Scripts fill forms instantly; people rarely do. Autofill can occasionally trip this.',
    strength: 'weak',
  },
  {
    key: 'suspiciousUserAgent',
    label: 'Suspicious user agent',
    description:
      'The browser identified itself with a scripting or crawler signature, or sent no user agent at all. Note that signups made server-side or through the API also land here, so this one produces false positives.',
    strength: 'weak',
  },
];

/**
 * The reasons a subscriber carries the "Suspected" chip, strongest first.
 *
 * Returns an empty array when nothing is flagged, so callers can treat length
 * as the question of whether there is anything to explain.
 */
export const describeBotFlags = (flags?: BotFlags): BotFlagReason[] => {
  if (!flags) return [];
  return REASONS.filter((reason) => flags[reason.key]);
};

/**
 * One-line summary for the chip's hover tooltip. The full descriptions live in
 * the profile modal — this is only meant to say why the chip is there.
 */
export const summarizeBotFlags = (flags?: BotFlags): string => {
  const reasons = describeBotFlags(flags);
  if (reasons.length === 0) {
    return 'One or more bot detection flags were triggered. Click for detail.';
  }
  return `Flagged for: ${reasons.map((r) => r.label).join(', ')}. Click for detail.`;
};

/**
 * Whether any flag is one a real subscriber essentially cannot trip. Drives the
 * "likely" vs "possible" wording in the profile modal — a subscriber carrying
 * only weak signals is genuinely ambiguous and should not be described as if it
 * were settled.
 */
export const hasStrongBotSignal = (flags?: BotFlags): boolean =>
  describeBotFlags(flags).some((reason) => reason.strength === 'strong');
