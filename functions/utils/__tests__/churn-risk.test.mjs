/**
 * Unit tests for churn-risk classification.
 *
 * These mirror the Rust tests in functions/src/api/controllers/churn.rs — the
 * two implementations must agree.
 */

import {
  isExcludedDormant,
  stalestStaleTopic,
  classifyReasons,
  classifySubscriber,
  summarizeAtRisk
} from '../churn-risk.mjs';

// Fixed "now" so staleness math is deterministic (matches the Rust tests).
const NOW = new Date('2026-07-18T00:00:00Z');

const sub = (email, lastEngagedIssue, engagementCount, interestScores) => ({
  email,
  lastEngagedIssue,
  engagementCount,
  ...(interestScores ? { interestScores } : {})
});

describe('isExcludedDormant', () => {
  it('excludes null/undefined lastEngagedIssue', () => {
    expect(isExcludedDormant(null, 20)).toBe(true);
    expect(isExcludedDormant(undefined, 20)).toBe(true);
  });

  it('excludes below the dormant cutoff', () => {
    // latest - 10 = 10; 9 < 10 → excluded
    expect(isExcludedDormant(9, 20)).toBe(true);
  });

  it('keeps the boundary at latest - 10', () => {
    expect(isExcludedDormant(10, 20)).toBe(false);
  });

  it('keeps recent engagement', () => {
    expect(isExcludedDormant(19, 20)).toBe(false);
  });
});

describe('fading', () => {
  it('fires inside the occasional window with history', () => {
    expect(classifyReasons(sub('a', 15, 4), 20, NOW).reasons).toEqual(['fading']);
  });

  it('fires at both window boundaries', () => {
    expect(classifyReasons(sub('u', 18, 3), 20, NOW).reasons).toEqual(['fading']);
    expect(classifyReasons(sub('l', 11, 3), 20, NOW).reasons).toEqual(['fading']);
  });

  it('requires an engagement history of >= 3', () => {
    expect(classifyReasons(sub('a', 15, 2), 20, NOW).reasons).toEqual([]);
  });

  it('does not fire for highly-engaged (above the window)', () => {
    expect(classifyReasons(sub('a', 19, 5), 20, NOW).reasons).toEqual([]);
  });
});

describe('streak_break', () => {
  it('fires for strong-but-silent, alongside fading in overlap', () => {
    const reasons = classifyReasons(sub('a', 12, 6), 20, NOW).reasons;
    expect(reasons).toContain('fading');
    expect(reasons).toContain('streak_break');
  });

  it('fires alone below the fading window but above dormant', () => {
    expect(classifyReasons(sub('a', 10, 5), 20, NOW).reasons).toEqual(['streak_break']);
  });

  it('requires engagementCount >= 5', () => {
    expect(classifyReasons(sub('a', 10, 4), 20, NOW).reasons).toEqual([]);
  });
});

describe('interest_stale', () => {
  it('fires for an old strong topic and reports it', () => {
    const s = sub('a', 19, 2, { ai: { score: 4, lastScoredAt: '2026-04-01T00:00:00Z' } });
    const result = classifyReasons(s, 20, NOW);
    expect(result.reasons).toEqual(['interest_stale']);
    expect(result.topTopic).toBe('ai');
  });

  it('does not fire for a fresh topic', () => {
    const s = sub('a', 19, 2, { ai: { score: 4, lastScoredAt: '2026-07-08T00:00:00Z' } });
    expect(classifyReasons(s, 20, NOW).reasons).toEqual([]);
  });

  it('ignores low-score topics', () => {
    const s = sub('a', 19, 2, { ai: { score: 2, lastScoredAt: '2026-01-01T00:00:00Z' } });
    expect(classifyReasons(s, 20, NOW).reasons).toEqual([]);
  });

  it('reports the stalest of several stale topics', () => {
    const s = sub('a', 19, 2, {
      ai: { score: 4, lastScoredAt: '2026-04-01T00:00:00Z' },
      devops: { score: 5, lastScoredAt: '2026-01-15T00:00:00Z' }
    });
    expect(stalestStaleTopic(s.interestScores, NOW).topic).toBe('devops');
  });

  it('skips an unparseable date', () => {
    const s = sub('a', 19, 2, { ai: { score: 4, lastScoredAt: 'not-a-date' } });
    expect(classifyReasons(s, 20, NOW).reasons).toEqual([]);
  });

  it('treats exactly 45 days as not-yet-stale', () => {
    const s = sub('a', 19, 2, { ai: { score: 4, lastScoredAt: '2026-06-03T00:00:00Z' } });
    expect(classifyReasons(s, 20, NOW).reasons).toEqual([]);
  });
});

describe('classifySubscriber', () => {
  it('excludes dormant even with a stale interest', () => {
    const s = sub('a', 5, 6, { ai: { score: 4, lastScoredAt: '2026-01-01T00:00:00Z' } });
    expect(classifySubscriber(s, 20, NOW)).toBeNull();
  });

  it('excludes never-engaged', () => {
    const s = sub('a', null, 6, { ai: { score: 4, lastScoredAt: '2026-01-01T00:00:00Z' } });
    expect(classifySubscriber(s, 20, NOW)).toBeNull();
  });

  it('returns null when there are no reasons', () => {
    expect(classifySubscriber(sub('a', 20, 10), 20, NOW)).toBeNull();
  });

  it('collects multiple reasons', () => {
    const s = sub('a', 12, 6, { ai: { score: 4, lastScoredAt: '2026-01-01T00:00:00Z' } });
    const result = classifySubscriber(s, 20, NOW);
    expect(result.email).toBe('a');
    expect(result.lastEngagedIssue).toBe(12);
    expect(result.engagementCount).toBe(6);
    expect(result.reasons).toEqual(expect.arrayContaining(['fading', 'streak_break', 'interest_stale']));
    expect(result.topTopic).toBe('ai');
  });
});

describe('summarizeAtRisk', () => {
  it('counts by reason, totals, and produces example strings', () => {
    const subscribers = [
      sub('one', 12, 6), // fading + streak_break
      sub('two', 15, 4), // fading
      sub('three', 18, 2, { ai: { score: 4, lastScoredAt: '2026-01-01T00:00:00Z' } }), // interest_stale
      sub('dormant', 3, 9), // excluded
      sub('healthy', 20, 10) // no reasons
    ];

    const summary = summarizeAtRisk(subscribers, 20, NOW);
    expect(summary.total).toBe(3);
    expect(summary.byReason).toEqual({ fading: 2, interestStale: 1, streakBreak: 1 });
    expect(summary.examples).toHaveLength(3);
    // Highest reason-count first (two@... has fading+streak = 2 reasons).
    expect(summary.examples[0]).toContain('Fading');
    expect(summary.examples[0]).toContain('Streak broken');
  });

  it('handles an empty list', () => {
    const summary = summarizeAtRisk([], 20, NOW);
    expect(summary.total).toBe(0);
    expect(summary.byReason).toEqual({ fading: 0, interestStale: 0, streakBreak: 0 });
    expect(summary.examples).toEqual([]);
  });
});
