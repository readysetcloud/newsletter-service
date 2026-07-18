/**
 * Churn-risk classification (leading indicators, not just recency buckets).
 *
 * IMPORTANT: this mirrors the Rust implementation in
 * functions/src/api/controllers/churn.rs. The admin `GET /subscribers/at-risk`
 * endpoint (Rust) and the monthly-report `atRiskSummary` (this module) must
 * classify subscribers identically — if you change a threshold here, change it
 * there too, and vice versa.
 *
 * Operates on unmarshalled subscriber objects with the shape:
 *   { email, lastEngagedIssue, engagementCount, interestScores: { topic: { score, lastScoredAt } } }
 */

// ── Thresholds (keep in sync with churn.rs) ────────────────────────────
export const FADING_MIN_ENGAGEMENT = 3;
export const STREAK_BREAK_MIN_ENGAGEMENT = 5;
export const INTEREST_SCORE_THRESHOLD = 3;
export const INTEREST_STALE_DAYS = 45;
export const OCCASIONAL_LOOKBACK = 9;
export const RECENT_LOOKBACK = 2;
export const DORMANT_LOOKBACK = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/**
 * True when a subscriber is already plain-dormant (never engaged, or last
 * engaged more than DORMANT_LOOKBACK issues ago) and therefore handled by the
 * sunset flow rather than the churn-risk report.
 */
export const isExcludedDormant = (lastEngagedIssue, latestIssueNumber) => {
  if (lastEngagedIssue === null || lastEngagedIssue === undefined) return true;
  return lastEngagedIssue < latestIssueNumber - DORMANT_LOOKBACK;
};

/**
 * Find the stalest topic (oldest lastScoredAt) whose score is >= the interest
 * threshold and whose lastScoredAt is older than the staleness window. Topics
 * with an unparseable lastScoredAt are skipped.
 *
 * @returns {{ topic: string, lastScoredAt: number } | null}
 */
export const stalestStaleTopic = (interestScores, now) => {
  if (!interestScores || typeof interestScores !== 'object') return null;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  let stalest = null;

  for (const [topic, entry] of Object.entries(interestScores)) {
    if (!entry || typeof entry !== 'object') continue;
    const score = Number(entry.score);
    if (!Number.isFinite(score) || score < INTEREST_SCORE_THRESHOLD) continue;

    if (!entry.lastScoredAt) continue;
    const scoredMs = new Date(entry.lastScoredAt).getTime();
    if (Number.isNaN(scoredMs)) continue; // skip unparseable

    const ageDays = Math.floor((nowMs - scoredMs) / MS_PER_DAY);
    if (ageDays <= INTEREST_STALE_DAYS) continue;

    if (stalest === null || scoredMs < stalest.lastScoredAt) {
      stalest = { topic, lastScoredAt: scoredMs };
    }
  }

  return stalest;
};

/**
 * Compute the risk reasons (and stalest interest topic) for a subscriber,
 * without applying the plain-dormant exclusion.
 *
 * @returns {{ reasons: string[], topTopic: string | null }}
 */
export const classifyReasons = (subscriber, latestIssueNumber, now = new Date()) => {
  const lastEngaged = toInt(subscriber?.lastEngagedIssue);
  const engagementCount = toInt(subscriber?.engagementCount) ?? 0;
  const reasons = [];

  // fading: was recently active (occasional window) but slipping, with history.
  if (
    lastEngaged !== null &&
    lastEngaged >= latestIssueNumber - OCCASIONAL_LOOKBACK &&
    lastEngaged <= latestIssueNumber - RECENT_LOOKBACK &&
    engagementCount >= FADING_MIN_ENGAGEMENT
  ) {
    reasons.push('fading');
  }

  // interest_stale: a strong topic interest has gone cold.
  const stale = stalestStaleTopic(subscriber?.interestScores, now);
  if (stale) {
    reasons.push('interest_stale');
  }

  // streak_break: historically strong but silent for 3+ issues.
  if (
    lastEngaged !== null &&
    engagementCount >= STREAK_BREAK_MIN_ENGAGEMENT &&
    lastEngaged < latestIssueNumber - RECENT_LOOKBACK
  ) {
    reasons.push('streak_break');
  }

  return { reasons, topTopic: stale ? stale.topic : null };
};

/**
 * Classify a subscriber into an at-risk record, or null if not at risk
 * (plain-dormant, or no risk reasons).
 *
 * @returns {{ email, lastEngagedIssue, engagementCount, reasons, topTopic } | null}
 */
export const classifySubscriber = (subscriber, latestIssueNumber, now = new Date()) => {
  const lastEngaged = toInt(subscriber?.lastEngagedIssue);
  if (isExcludedDormant(lastEngaged, latestIssueNumber)) return null;

  const { reasons, topTopic } = classifyReasons(subscriber, latestIssueNumber, now);
  if (reasons.length === 0) return null;

  return {
    email: subscriber?.email,
    lastEngagedIssue: lastEngaged,
    engagementCount: toInt(subscriber?.engagementCount) ?? 0,
    reasons,
    topTopic
  };
};

/**
 * Summarize churn risk across a list of subscriber objects: total at-risk,
 * counts by reason, and up to three human-readable example reason strings for
 * the LLM to reference.
 *
 * @returns {{ total, byReason: { fading, interestStale, streakBreak }, examples: string[] }}
 */
export const summarizeAtRisk = (subscribers, latestIssueNumber, now = new Date()) => {
  const byReason = { fading: 0, interestStale: 0, streakBreak: 0 };
  const atRisk = [];

  for (const subscriber of subscribers ?? []) {
    const classified = classifySubscriber(subscriber, latestIssueNumber, now);
    if (!classified) continue;
    atRisk.push(classified);
    for (const reason of classified.reasons) {
      if (reason === 'fading') byReason.fading += 1;
      else if (reason === 'interest_stale') byReason.interestStale += 1;
      else if (reason === 'streak_break') byReason.streakBreak += 1;
    }
  }

  // Sort by reason count desc, then lastEngagedIssue asc (most silent first).
  atRisk.sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      (a.lastEngagedIssue ?? Infinity) - (b.lastEngagedIssue ?? Infinity)
  );

  const examples = atRisk.slice(0, 3).map((s) => {
    const labels = s.reasons.map((r) => REASON_LABELS[r] ?? r);
    const topic = s.topTopic ? ` (topic: ${s.topTopic})` : '';
    return `last engaged issue ${s.lastEngagedIssue}, ${s.engagementCount} issues engaged — ${labels.join(', ')}${topic}`;
  });

  return { total: atRisk.length, byReason, examples };
};

/** Human-readable reason labels, matching the dashboard's reason chips. */
export const REASON_LABELS = {
  fading: 'Fading',
  interest_stale: 'Interests gone stale (AI)',
  streak_break: 'Streak broken'
};
